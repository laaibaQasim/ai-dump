Setup the log-analysis module.
---
description: >-
  Initialize log-analysis: install Python requirements, check GEMINI_API_KEY,
  add analysis/ to .git/info/exclude.
---

# Setup — log-analysis

One-time local setup for the `log-analysis` pipeline.

Follow this exact flow:

1. Verify prerequisites:
   - Confirm `log-analysis/requirements.txt` exists. If it does not, stop and report the missing file.
   - Check that `python` or `python3` is on the PATH. If neither is found, stop and tell the user Python 3.9+ is required.

2. Install Python dependencies:
   - Run: `pip install -r log-analysis/requirements.txt`
   - If `pip` is unavailable, try `pip3`.
   - If installation fails, report the error and stop.

3. Check for `.env` and `GEMINI_API_KEY`:
   - If `.env` does not exist, create it with this exact content:
     ```
     GEMINI_API_KEY=your_key_here
     ```
   - If `.env` exists but does not contain `GEMINI_API_KEY`, append `GEMINI_API_KEY=your_key_here` on a new line.
   - If `.env` already contains `GEMINI_API_KEY`, leave it unchanged.
   - Remind the user to replace `your_key_here` with a real key from https://aistudio.google.com/app/apikey.

4. Add `analysis/` to `.git/info/exclude`:
   - Only do this if a `.git/` directory exists in the repo root.
   - Ensure `.git/info/` exists.
   - If `analysis/` is not already in `.git/info/exclude`, append it.
   - This keeps generated output files out of git without modifying the shared `.gitignore`.

5. Provide a concise summary that includes:
   - Whether pip install succeeded
   - Whether `.env` was created, updated, or already correct
   - Whether `.git/info/exclude` was updated
   - The command to run the pipeline (shown verbatim):
     ```
     python log-analysis/log_analysis.py prepare
     python log-analysis/log_analysis.py run-all --out-dir analysis
     ```

Rules:
- Do not use sudo.
- Do not touch files outside this repository.
- Never overwrite an existing `.env` key value.
- If this is not a git repo, skip the exclude-file step and say so.
