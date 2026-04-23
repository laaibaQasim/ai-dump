import argparse
import collections
import csv
import json
import logging
import os
import random
import re
import sys
import tempfile
import time
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

import openai
from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()

logger = logging.getLogger("log_analysis")

DEFAULT_MODEL = "gemma-4-31b-it"
DEFAULT_INPUT_DIR = "work-logs"
DEFAULT_OUT_DIR = "analysis"

GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/"

RPM_LIMIT = 15
TPM_LIMIT = 90_000  # 10% headroom below the 100.79K hard cap
CHARS_PER_TOKEN = 4  # conservative estimate

MAX_SYNTHESIS_CHARS = 80_000

_RETRYABLE_ERRORS = (
    openai.RateLimitError,
    openai.APIConnectionError,
    openai.APITimeoutError,
    openai.InternalServerError,
)

PASS_CONFIGS = {
    "pass1_prompt_audit": {
        "batch_size": 25,
        "input_file": "phase1/flat.jsonl",
        "system_instruction": (
            "You are auditing prompt quality in AI workflow logs. "
            "Focus on whether the user intent was under specified, ambiguous, or missing constraints. "
            "Compare user_intent, prompt_summary, what_i_did, open_issues, and next_best_step. "
            "Be conservative and evidence-based.\n\n"
            "You MUST respond with valid JSON matching this exact schema:\n"
            "{\n"
            '  "batch_summary": "<string>",\n'
            '  "recurring_patterns": [\n'
            "    {\n"
            '      "pattern_name": "<string>",\n'
            '      "frequency_in_batch": <integer>,\n'
            '      "why_it_hurts": "<string>",\n'
            '      "before_prompt_example": "<string>",\n'
            '      "after_prompt_template": "<string>",\n'
            '      "evidence_row_ids": ["<string>", ...]\n'
            "    }\n"
            "  ]\n"
            "}"
        ),
    },
    "pass2_cost": {
        "batch_size": 25,
        "input_file": "phase1/flat.jsonl",
        "system_instruction": (
            "You are auditing model usage efficiency in AI workflow logs. "
            "Estimate whether the logged task appears low, medium, or high complexity. "
            "Identify cases where a cheaper or smaller model likely could have handled the task. "
            "Use only the information present in the logs.\n\n"
            "You MUST respond with valid JSON matching this exact schema:\n"
            "{\n"
            '  "batch_summary": "<string>",\n'
            '  "items": [\n'
            "    {\n"
            '      "row_id": "<string>",\n'
            '      "task_complexity": "low" | "medium" | "high",\n'
            '      "overkill": <boolean>,\n'
            '      "recommended_tier": "<string>",\n'
            '      "reason": "<string>"\n'
            "    }\n"
            "  ]\n"
            "}"
        ),
    },
    "pass3_skills": {
        "batch_size": 40,
        "input_file": "phase1/flat.jsonl",
        "system_instruction": (
            "You are extracting repeatable workflow skills from AI work logs. "
            "Cluster similar tasks across rows. Focus on repetitive work that could become a reusable prompt template, "
            "a script, a documented workflow, or a custom skill.\n\n"
            "You MUST respond with valid JSON matching this exact schema:\n"
            "{\n"
            '  "batch_summary": "<string>",\n'
            '  "skill_candidates": [\n'
            "    {\n"
            '      "skill_name": "<string>",\n'
            '      "trigger_pattern": "<string>",\n'
            '      "what_it_should_do": "<string>",\n'
            '      "automation_type": "<string>",\n'
            '      "frequency_in_batch": <integer>,\n'
            '      "evidence_row_ids": ["<string>", ...]\n'
            "    }\n"
            "  ]\n"
            "}"
        ),
    },
    "pass4_rules": {
        "batch_size": 30,
        "input_file": "phase1/flat.jsonl",
        "system_instruction": (
            "You are extracting durable rules from AI workflow logs. "
            "Find recurring AI mistakes, recurring user instructions, and durable rules that could go into .cursorrules "
            "or a system prompt. Do not propose rules unless they are supported by repeated evidence.\n\n"
            "You MUST respond with valid JSON matching this exact schema:\n"
            "{\n"
            '  "batch_summary": "<string>",\n'
            '  "rules_for_model": ["<string>", ...],\n'
            '  "rules_for_user_prompting": ["<string>", ...],\n'
            '  "evidence": [\n'
            "    {\n"
            '      "rule_text": "<string>",\n'
            '      "evidence_row_ids": ["<string>", ...]\n'
            "    }\n"
            "  ]\n"
            "}"
        ),
    },
}

SYNTHESIS_SYSTEM_INSTRUCTION = (
    "You are synthesizing multiple batch analyses of AI workflow logs. "
    "Merge overlaps, deduplicate weak points, and prioritize the most important actions.\n\n"
    "You MUST respond with valid JSON matching this exact schema:\n"
    "{\n"
    '  "top_prompt_fixes": ["<string>", ...],\n'
    '  "top_cost_saving_opportunities": ["<string>", ...],\n'
    '  "top_skills_to_build": ["<string>", ...],\n'
    '  "top_rules_to_add": ["<string>", ...],\n'
    '  "workflow_recommendations": ["<string>", ...]\n'
    "}"
)


# ---------------------------------------------------------------------------
# Rate limiter
# ---------------------------------------------------------------------------

class RateLimiter:
    """Sliding-window rate limiter for RPM and TPM constraints."""

    def __init__(self, rpm: int = RPM_LIMIT, tpm: int = TPM_LIMIT) -> None:
        self._rpm = rpm
        self._tpm = tpm
        self._request_times: collections.deque = collections.deque()
        self._token_log: collections.deque = collections.deque()  # (timestamp, tokens)

    def _purge_old(self, now: float) -> None:
        cutoff = now - 60.0
        while self._request_times and self._request_times[0] < cutoff:
            self._request_times.popleft()
        while self._token_log and self._token_log[0][0] < cutoff:
            self._token_log.popleft()

    def _tokens_in_window(self) -> int:
        return sum(t for _, t in self._token_log)

    def wait_if_needed(self, estimated_tokens: int) -> None:
        now = time.monotonic()
        self._purge_old(now)

        if len(self._request_times) >= self._rpm:
            wait = self._request_times[0] - (now - 60.0)
            if wait > 0:
                logger.info("RPM throttle: sleeping %.1fs", wait)
                time.sleep(wait)
                now = time.monotonic()
                self._purge_old(now)

        current_tokens = self._tokens_in_window()
        if current_tokens + estimated_tokens > self._tpm:
            if self._token_log:
                wait = self._token_log[0][0] - (now - 60.0)
                if wait > 0:
                    logger.info("TPM throttle: sleeping %.1fs (window: %d + %d > %d)",
                                wait, current_tokens, estimated_tokens, self._tpm)
                    time.sleep(wait)
                    now = time.monotonic()
                    self._purge_old(now)

        self._request_times.append(now)
        self._token_log.append((now, estimated_tokens))


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def get_client() -> OpenAI:
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY is not set")
    return OpenAI(api_key=api_key, base_url=GEMINI_BASE_URL, max_retries=0)


def ensure_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def read_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def write_json(path: Path, data: Any) -> None:
    ensure_dir(path.parent)
    with path.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def atomic_write_text(path: Path, text: str) -> None:
    """Write text to a temp file then atomically rename to the target path."""
    ensure_dir(path.parent)
    fd, tmp = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(text)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def estimate_tokens(text: str) -> int:
    return max(1, len(text) // CHARS_PER_TOKEN)


# ---------------------------------------------------------------------------
# Data preparation
# ---------------------------------------------------------------------------

def normalize_session(session: Dict[str, Any], source_file: str) -> List[Dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    session_logs = session.get("session_logs", []) or []
    started_at = session.get("started_at")
    date = started_at[:10] if isinstance(started_at, str) and len(started_at) >= 10 else None

    for idx, log in enumerate(session_logs):
        rows.append({
            "source_file": source_file,
            "date": date,
            "session_id": session.get("session_id"),
            "tool": session.get("tool"),
            "model": session.get("model"),
            "started_at": session.get("started_at"),
            "ended_at": session.get("ended_at"),
            "duration_minutes": session.get("duration_minutes"),
            "project_name": session.get("project_name"),
            "project_path": session.get("project_path"),
            "branch_name": session.get("branch_name"),
            "log_index": idx,
            "captured_at": log.get("captured_at"),
            "user_intent": log.get("user_intent"),
            "prompt_summary": log.get("prompt_summary"),
            "provided_context": log.get("provided_context"),
            "what_i_did": log.get("what_i_did"),
            "open_issues": log.get("open_issues"),
            "next_best_step": log.get("next_best_step"),
        })
    return rows


def prepare_data(input_dir: Path, out_dir: Path) -> None:
    phase1_dir = out_dir / "phase1"
    ensure_dir(phase1_dir)

    aggregate: List[Any] = []
    flat_rows: List[Dict[str, Any]] = []

    for path in sorted(input_dir.glob("*.json")):
        try:
            data = read_json(path)
        except (json.JSONDecodeError, OSError) as exc:
            logger.warning("Skipping malformed input file %s: %s", path.name, exc)
            continue
        if isinstance(data, dict) and "sessions" in data:
            sessions = data["sessions"]
        elif isinstance(data, list):
            sessions = data
        else:
            sessions = [data]
        for session in sessions:
            aggregate.append(session)
            flat_rows.extend(normalize_session(session, path.name))

    write_json(phase1_dir / "aggregate.json", aggregate)

    flat_jsonl = phase1_dir / "flat.jsonl"
    with flat_jsonl.open("w", encoding="utf-8") as f:
        for row in flat_rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")

    if flat_rows:
        with (phase1_dir / "flat.csv").open("w", encoding="utf-8", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=list(flat_rows[0].keys()))
            writer.writeheader()
            writer.writerows(flat_rows)

    logger.info("Prepared %d sessions and %d flattened rows", len(aggregate), len(flat_rows))
    logger.info("Output: %s", phase1_dir)


# ---------------------------------------------------------------------------
# Batch helpers
# ---------------------------------------------------------------------------

def load_jsonl_rows(path: Path) -> List[Dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as f:
        for i, line in enumerate(f):
            row = json.loads(line)
            row["row_id"] = f"row_{i+1}"
            rows.append(row)
    return rows


def chunked(items: List[Dict[str, Any]], size: int) -> Iterable[List[Dict[str, Any]]]:
    for i in range(0, len(items), size):
        yield items[i:i + size]


def make_payload(pass_name: str, batch: List[Dict[str, Any]]) -> Dict[str, Any]:
    if pass_name == "pass1_prompt_audit":
        rows = [{
            "row_id": r["row_id"],
            "date": r.get("date"),
            "tool": r.get("tool"),
            "model": r.get("model"),
            "project_name": r.get("project_name"),
            "user_intent": r.get("user_intent"),
            "prompt_summary": r.get("prompt_summary"),
            "what_i_did": r.get("what_i_did"),
            "open_issues": r.get("open_issues"),
            "next_best_step": r.get("next_best_step"),
        } for r in batch]
        return {
            "task": "Prompt audit",
            "instructions": [
                "Find recurring ambiguity patterns.",
                "Return at most 3 strongest recurring patterns in this batch.",
                "Use only evidence from the batch.",
            ],
            "rows": rows,
        }

    if pass_name == "pass2_cost":
        rows = [{
            "row_id": r["row_id"],
            "tool": r.get("tool"),
            "model": r.get("model"),
            "user_intent": r.get("user_intent"),
            "prompt_summary": r.get("prompt_summary"),
            "what_i_did": r.get("what_i_did"),
            "open_issues": r.get("open_issues"),
        } for r in batch]
        return {
            "task": "Cost and model optimization",
            "model_tiers_note": "Use generic tiers like tiny, small, mid, and high-end. Do not invent exact prices.",
            "rows": rows,
        }

    if pass_name == "pass3_skills":
        rows = [{
            "row_id": r["row_id"],
            "project_name": r.get("project_name"),
            "tool": r.get("tool"),
            "user_intent": r.get("user_intent"),
            "prompt_summary": r.get("prompt_summary"),
            "what_i_did": r.get("what_i_did"),
            "next_best_step": r.get("next_best_step"),
        } for r in batch]
        return {
            "task": "Skills extraction",
            "rules": [
                "Only propose skills supported by repeated evidence in the batch.",
                "Prefer concrete workflow skills over vague advice.",
            ],
            "rows": rows,
        }

    if pass_name == "pass4_rules":
        rows = [{
            "row_id": r["row_id"],
            "tool": r.get("tool"),
            "model": r.get("model"),
            "prompt_summary": r.get("prompt_summary"),
            "provided_context": r.get("provided_context"),
            "what_i_did": r.get("what_i_did"),
            "open_issues": r.get("open_issues"),
            "next_best_step": r.get("next_best_step"),
        } for r in batch]
        return {
            "task": "Rules extraction",
            "rows": rows,
        }

    raise ValueError(f"Unknown pass: {pass_name}")


# ---------------------------------------------------------------------------
# Model interaction
# ---------------------------------------------------------------------------

def call_with_retry(
    client: OpenAI,
    model: str,
    system_instruction: str,
    payload: Dict[str, Any],
    rate_limiter: RateLimiter,
    retries: int,
    sleep_seconds: float,
) -> dict:
    """Call the model and return parsed JSON. Retries only on transient errors."""
    user_content = json.dumps(payload, ensure_ascii=False)
    estimated = estimate_tokens(user_content + system_instruction)
    rate_limiter.wait_if_needed(estimated)

    last_error: Optional[Exception] = None
    for attempt in range(1, retries + 1):
        try:
            response = client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": system_instruction},
                    {"role": "user", "content": user_content},
                ],
                response_format={"type": "json_object"},
            )

            if not response.choices:
                raise RuntimeError("Model returned empty choices (response may have been blocked)")

            text = response.choices[0].message.content
            if text is None:
                raise RuntimeError("Model returned null content (response may have been blocked)")

            text = re.sub(r"<thought>.*?</thought>", "", text, flags=re.DOTALL).strip()

            try:
                parsed = json.loads(text)
            except json.JSONDecodeError as exc:
                raise RuntimeError(
                    f"Model returned invalid JSON: {exc}\nRaw (first 500 chars): {text[:500]}"
                ) from exc

            return parsed

        except _RETRYABLE_ERRORS as exc:
            last_error = exc
            logger.warning("Attempt %d/%d failed (retryable): %s", attempt, retries, exc)
            if attempt == retries:
                break
            delay = sleep_seconds * (2 ** (attempt - 1)) + random.uniform(0, 1)
            logger.info("Sleeping %.1fs before retry %d/%d", delay, attempt + 1, retries)
            time.sleep(delay)

    raise RuntimeError(f"Model call failed after {retries} attempts: {last_error}")


# ---------------------------------------------------------------------------
# Pass runner
# ---------------------------------------------------------------------------

def run_pass(
    pass_name: str,
    input_path: Path,
    out_dir: Path,
    model: str,
    batch_size: int,
    retries: int,
    sleep_seconds: float,
    resume: bool,
    start_batch: int,
    end_batch: Optional[int],
    rate_limiter: RateLimiter,
    dry_run: bool = False,
) -> None:
    client = get_client()
    rows = load_jsonl_rows(input_path)
    pass_dir = out_dir / pass_name
    ensure_dir(pass_dir)

    cfg = PASS_CONFIGS[pass_name]
    batches = list(chunked(rows, batch_size))
    total = len(batches)

    if dry_run:
        total_tokens = 0
        for i, batch in enumerate(batches, start=1):
            payload = make_payload(pass_name, batch)
            payload_str = json.dumps(payload, ensure_ascii=False)
            tokens = estimate_tokens(payload_str + cfg["system_instruction"])
            total_tokens += tokens
            logger.info("[dry-run] batch %d: %d rows, ~%d chars, ~%d tokens",
                        i, len(batch), len(payload_str), tokens)
        est_minutes = (total * 60.0) / RPM_LIMIT / 60.0
        logger.info("[dry-run] %s: %d batches, ~%d total tokens, ~%.1f min at %d RPM",
                    pass_name, total, total_tokens, est_minutes, RPM_LIMIT)
        return

    for i, batch in enumerate(batches, start=1):
        if i < start_batch:
            continue
        if end_batch is not None and i > end_batch:
            break

        out_path = pass_dir / f"batch_{i:03d}.json"
        if resume and out_path.exists():
            logger.info("Skipping existing %s", out_path.name)
            continue

        payload = make_payload(pass_name, batch)
        parsed = call_with_retry(
            client=client,
            model=model,
            system_instruction=cfg["system_instruction"],
            payload=payload,
            rate_limiter=rate_limiter,
            retries=retries,
            sleep_seconds=sleep_seconds,
        )

        atomic_write_text(out_path, json.dumps(parsed, ensure_ascii=False, indent=2))
        logger.info("[%d/%d] wrote %s", i, total, out_path)


# ---------------------------------------------------------------------------
# Synthesis
# ---------------------------------------------------------------------------

def load_json_files(folder: Path) -> List[dict]:
    out: list[dict] = []
    for path in sorted(folder.glob("*.json")):
        out.append(read_json(path))
    return out


def _synthesize_single(
    client: OpenAI,
    model: str,
    payload: Dict[str, Any],
    rate_limiter: RateLimiter,
    retries: int,
    sleep_seconds: float,
) -> dict:
    return call_with_retry(
        client=client,
        model=model,
        system_instruction=SYNTHESIS_SYSTEM_INSTRUCTION,
        payload=payload,
        rate_limiter=rate_limiter,
        retries=retries,
        sleep_seconds=sleep_seconds,
    )


def synthesize(
    out_dir: Path,
    model: str,
    retries: int,
    sleep_seconds: float,
    rate_limiter: RateLimiter,
) -> None:
    client = get_client()
    final_dir = out_dir / "final"
    ensure_dir(final_dir)

    full_payload = {
        "prompt_audit_batches": load_json_files(out_dir / "pass1_prompt_audit"),
        "cost_batches": load_json_files(out_dir / "pass2_cost"),
        "skill_batches": load_json_files(out_dir / "pass3_skills"),
        "rules_batches": load_json_files(out_dir / "pass4_rules"),
    }

    payload_str = json.dumps(full_payload, ensure_ascii=False)

    if len(payload_str) <= MAX_SYNTHESIS_CHARS:
        result = _synthesize_single(
            client, model, full_payload, rate_limiter, retries, sleep_seconds,
        )
    else:
        logger.warning(
            "Synthesis payload too large (%d chars > %d). Running chunked synthesis.",
            len(payload_str), MAX_SYNTHESIS_CHARS,
        )
        partial_results: list[dict] = []
        for key in full_payload:
            chunk_payload = {key: full_payload[key]}
            chunk_str = json.dumps(chunk_payload, ensure_ascii=False)
            if len(chunk_str) > MAX_SYNTHESIS_CHARS:
                items = full_payload[key]
                mid = len(items) // 2
                for sub in (items[:mid], items[mid:]):
                    partial_results.append(_synthesize_single(
                        client, model, {key: sub}, rate_limiter, retries, sleep_seconds,
                    ))
            else:
                partial_results.append(_synthesize_single(
                    client, model, chunk_payload, rate_limiter, retries, sleep_seconds,
                ))

        merge_payload = {"partial_results": partial_results}
        result = _synthesize_single(
            client, model, merge_payload, rate_limiter, retries, sleep_seconds,
        )

    out_path = final_dir / "final_report.json"
    atomic_write_text(out_path, json.dumps(result, ensure_ascii=False, indent=2))
    logger.info("Wrote %s", out_path)


# ---------------------------------------------------------------------------
# Inspect
# ---------------------------------------------------------------------------

def inspect(out_dir: Path) -> None:
    phase1 = out_dir / "phase1" / "flat.jsonl"
    if not phase1.exists():
        logger.warning("phase1/flat.jsonl not found")
        return
    rows = load_jsonl_rows(phase1)
    logger.info("Flattened rows: %d", len(rows))
    for pass_name, cfg in PASS_CONFIGS.items():
        pass_dir = out_dir / pass_name
        existing = len(list(pass_dir.glob("batch_*.json"))) if pass_dir.exists() else 0
        expected = (len(rows) + cfg["batch_size"] - 1) // cfg["batch_size"]
        logger.info("%s: %d/%d batch files", pass_name, existing, expected)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="AI log analysis pipeline")
    parser.add_argument("--verbose", action="store_true", help="Enable debug logging")
    sub = parser.add_subparsers(dest="command", required=True)

    p_prepare = sub.add_parser("prepare", help="Flatten raw logs into analysis files")
    p_prepare.add_argument("--input-dir", default=DEFAULT_INPUT_DIR)
    p_prepare.add_argument("--out-dir", default=DEFAULT_OUT_DIR)

    p_run = sub.add_parser("run-pass", help="Run one analysis pass")
    p_run.add_argument("pass_name", choices=list(PASS_CONFIGS.keys()))
    p_run.add_argument("--out-dir", default=DEFAULT_OUT_DIR)
    p_run.add_argument("--model", default=DEFAULT_MODEL)
    p_run.add_argument("--batch-size", type=int, default=None)
    p_run.add_argument("--retries", type=int, default=5)
    p_run.add_argument("--sleep-seconds", type=float, default=3.0)
    p_run.add_argument("--no-resume", action="store_true")
    p_run.add_argument("--start-batch", type=int, default=1)
    p_run.add_argument("--end-batch", type=int, default=None)
    p_run.add_argument("--dry-run", action="store_true", help="Preview without API calls")

    p_all = sub.add_parser("run-all", help="Run all passes and final synthesis")
    p_all.add_argument("--out-dir", default=DEFAULT_OUT_DIR)
    p_all.add_argument("--model", default=DEFAULT_MODEL)
    p_all.add_argument("--retries", type=int, default=5)
    p_all.add_argument("--sleep-seconds", type=float, default=3.0)
    p_all.add_argument("--dry-run", action="store_true", help="Preview without API calls")

    p_syn = sub.add_parser("synthesize", help="Create final report from pass outputs")
    p_syn.add_argument("--out-dir", default=DEFAULT_OUT_DIR)
    p_syn.add_argument("--model", default=DEFAULT_MODEL)
    p_syn.add_argument("--retries", type=int, default=5)
    p_syn.add_argument("--sleep-seconds", type=float, default=3.0)

    p_inspect = sub.add_parser("inspect", help="Show pipeline progress")
    p_inspect.add_argument("--out-dir", default=DEFAULT_OUT_DIR)

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)-8s %(message)s",
        datefmt="%H:%M:%S",
    )

    out_dir = Path(getattr(args, "out_dir", DEFAULT_OUT_DIR))
    rate_limiter = RateLimiter()

    if args.command == "prepare":
        prepare_data(Path(args.input_dir), Path(args.out_dir))
        return 0

    if args.command == "run-pass":
        pass_name = args.pass_name
        cfg = PASS_CONFIGS[pass_name]
        batch_size = args.batch_size or cfg["batch_size"]
        input_path = out_dir / cfg["input_file"]
        if not input_path.exists():
            logger.error("Missing input file: %s", input_path)
            return 1
        run_pass(
            pass_name=pass_name,
            input_path=input_path,
            out_dir=out_dir,
            model=args.model,
            batch_size=batch_size,
            retries=args.retries,
            sleep_seconds=args.sleep_seconds,
            resume=not args.no_resume,
            start_batch=args.start_batch,
            end_batch=args.end_batch,
            rate_limiter=rate_limiter,
            dry_run=args.dry_run,
        )
        return 0

    if args.command == "run-all":
        dry_run = args.dry_run
        for pass_name, cfg in PASS_CONFIGS.items():
            input_path = out_dir / cfg["input_file"]
            if not input_path.exists():
                logger.error("Missing input file: %s", input_path)
                return 1
            run_pass(
                pass_name=pass_name,
                input_path=input_path,
                out_dir=out_dir,
                model=args.model,
                batch_size=cfg["batch_size"],
                retries=args.retries,
                sleep_seconds=args.sleep_seconds,
                resume=True,
                start_batch=1,
                end_batch=None,
                rate_limiter=rate_limiter,
                dry_run=dry_run,
            )
        if not dry_run:
            synthesize(
                out_dir=out_dir,
                model=args.model,
                retries=args.retries,
                sleep_seconds=args.sleep_seconds,
                rate_limiter=rate_limiter,
            )
        return 0

    if args.command == "synthesize":
        synthesize(
            out_dir=out_dir,
            model=args.model,
            retries=args.retries,
            sleep_seconds=args.sleep_seconds,
            rate_limiter=rate_limiter,
        )
        return 0

    if args.command == "inspect":
        inspect(out_dir)
        return 0

    parser.print_help()
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
