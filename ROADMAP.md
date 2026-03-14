# ReelPod Studio — Roadmap

## Candidates

- [ ] [candidate] **comfy-diffusion LLM support update** — Add a new iteration to the `comfy-diffusion` vendor exposing local LLM inference. Prerequisite for the prompt orchestrator; may require compatibility refactoring in the ReelPod backend. Effort: M. Target: `it_000025`.
- [ ] [candidate] **Single-prompt LLM orchestrator (local)** — Replace all input parameters with a single free-text field. A local LLM (integrated via `comfy-diffusion`) interprets the user's text and generates specialized prompts for ACEStep (music), Anima (image/animation), and WAN (video). One natural-language intent → three synchronized generation pipelines running 100% locally. Effort: L. Target: `it_000026`.
