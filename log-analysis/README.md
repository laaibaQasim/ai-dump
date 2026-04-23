# log-analysis

A Python pipeline that reads your `work-logs/*.json` session files and runs them through four LLM analysis passes using the Gemini API, then synthesizes the results into a single prioritized report.

---

## Table of Contents

- [Features](#features)
- [Prerequisites](#prerequisites)
- [Getting Started](#getting-started)
- [Usage](#usage)
- [CLI Reference](#cli-reference)
- [Output Structure](#output-structure)
- [Rate Limits](#rate-limits)
- [Architecture](#architecture)
- [Contributing](#contributing)
- [License](#license)

---

## Features

- **Multi-pass analysis** — four specialized LLM passes extract different insight categories
- **Resume-capable** — interrupted runs pick up where they left off
- **Dry-run mode** — preview token estimates and batch sizes without making API calls
- **Built-in rate limiting** — sliding-window limiter respects Gemini free-tier quotas automatically
- **Atomic writes** — temp file + rename strategy prevents corrupt output
- **Chunked synthesis** — handles large payloads by splitting across multiple API calls

---

## Prerequisites

- Python 3.9+
- A [Gemini API key](https://aistudio.google.com/app/apikey) (free tier works)

---

## Getting Started

<details>
<summary><strong>Option A: Automated setup</strong></summary>

Run the `/setup-analysis` command in Cursor chat. It installs dependencies, creates the `.env` file, and configures git exclusions for you.

</details>

<details>
<summary><strong>Option B: Manual setup</strong></summary>

**1. Install dependencies**

```bash
pip install -r log-analysis/requirements.txt
```

**2. Set your API key**

Create a `.env` file in the project root (if one doesn't exist) and add:

```env
GEMINI_API_KEY=your_key_here
```

**3. Exclude output from git**

```bash
echo "analysis/" >> .git/info/exclude
```

</details>

---

## Usage

All commands are run from the **project root**.

### Quick start

```bash
# 1. Flatten logs into analysis-ready files (required once per log batch)
python log-analysis/log_analysis.py prepare

# 2. Run all passes and generate the final report
python log-analysis/log_analysis.py run-all --out-dir analysis
```

<details>
<summary><strong>More examples</strong></summary>

```bash
# Verbose logging
python log-analysis/log_analysis.py --verbose run-all --out-dir analysis

# Dry run — preview token estimates, no API calls
python log-analysis/log_analysis.py run-all --out-dir analysis --dry-run

# Run a single pass
python log-analysis/log_analysis.py run-pass pass1_prompt_audit --out-dir analysis

# Re-run synthesis over existing pass outputs
python log-analysis/log_analysis.py synthesize --out-dir analysis

# Inspect pipeline progress
python log-analysis/log_analysis.py inspect --out-dir analysis
```

</details>

---

## CLI Reference

### Commands

| Command | Description |
|---------|-------------|
| `prepare` | Flatten `work-logs/*.json` into `analysis/phase1/` |
| `run-all` | Run all four passes and synthesize |
| `run-pass <pass>` | Run one pass (`pass1_prompt_audit`, `pass2_cost`, `pass3_skills`, `pass4_rules`) |
| `synthesize` | Re-run synthesis over existing pass outputs |
| `inspect` | Show batch file counts vs. expected for each pass |

<details>
<summary><strong>Global flags</strong></summary>

| Flag | Default | Description |
|------|---------|-------------|
| `--verbose` | off | Enable debug-level logging |

</details>

<details>
<summary><strong><code>run-all</code> / <code>run-pass</code> flags</strong></summary>

| Flag | Default | Description |
|------|---------|-------------|
| `--out-dir` | `analysis` | Output directory |
| `--model` | `gemma-4-31b-it` | Gemini model to use |
| `--dry-run` | off | Preview batch sizes and token estimates; no API calls |
| `--retries` | `5` | Max retries on transient errors |
| `--sleep-seconds` | `3.0` | Base sleep between retries |

</details>

<details>
<summary><strong><code>run-pass</code>-only flags</strong></summary>

| Flag | Description |
|------|-------------|
| `--batch-size` | Override the default batch size for this pass |
| `--no-resume` | Re-run batches even if output files already exist |
| `--start-batch N` | Start from batch N (useful for resuming) |
| `--end-batch N` | Stop after batch N |

</details>

---

## Output Structure

```
analysis/
├── phase1/
│   ├── aggregate.json        # All sessions merged
│   ├── flat.jsonl            # One row per session log entry
│   └── flat.csv              # Same as JSONL, in CSV format
├── pass1_prompt_audit/
│   └── batch_001.json ...
├── pass2_cost/
│   └── batch_001.json ...
├── pass3_skills/
│   └── batch_001.json ...
├── pass4_rules/
│   └── batch_001.json ...
└── final/
    └── final_report.json     # Top fixes, cost opportunities, skills, rules
```

---

## Rate Limits

The pipeline respects Gemini free-tier limits (**15 RPM / 90K TPM**) with a sliding-window rate limiter. Long runs throttle automatically — no extra configuration needed.

---

## Architecture

<details>
<summary><strong>Pipeline overview</strong></summary>

```
work-logs/*.json
       │
       ▼
   ┌────────┐
   │ prepare │  Normalize & flatten into JSONL/CSV
   └───┬────┘
       │
       ▼
   ┌────────────────────────────────────────┐
   │             run-all / run-pass         │
   │                                        │
   │  Pass 1 — Prompt audit                 │
   │  Pass 2 — Cost / model optimization    │
   │  Pass 3 — Skills clustering            │
   │  Pass 4 — Rules extraction             │
   └───┬────────────────────────────────────┘
       │
       ▼
   ┌────────────┐
   │ synthesize  │  Merge all pass outputs
   └───┬────────┘
       │
       ▼
  final_report.json
```

</details>

<details>
<summary><strong>What each pass does</strong></summary>

| Pass | Purpose |
|------|---------|
| **Pass 1 — Prompt audit** | Finds recurring ambiguity patterns in how you prompt the AI |
| **Pass 2 — Cost / model** | Flags tasks where a cheaper model tier likely would have sufficed |
| **Pass 3 — Skills** | Clusters repeated tasks that could become reusable scripts or prompt templates |
| **Pass 4 — Rules** | Extracts durable rules and recurring AI mistakes suitable for `.cursorrules` |
| **Synthesize** | Merges all pass outputs into one prioritized `final_report.json` |

</details>

---

## Contributing

Contributions are welcome! To get started:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Commit your changes (`git commit -m 'Add my feature'`)
4. Push to the branch (`git push origin feature/my-feature`)
5. Open a Pull Request

Please make sure your changes work with `--dry-run` before submitting.

---

## License

This project is provided as-is. See [LICENSE](../LICENSE) for details.
