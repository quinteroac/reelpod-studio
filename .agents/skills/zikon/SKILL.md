---
name: zikon
description: Generate an SVG logo from a text prompt using Zikon's pipeline (prompt → PNG → SVG). Returns a JSON object with paths and inline SVG markup.
parameters:
  - name: prompt
    type: string
    description: Text description of the logo or icon to generate.
    required: true
  - name: model
    type: string
    description: Diffusion model to use. Accepts "z-image-turbo", "sdxl", a HuggingFace repo ID, or a local directory path.
    required: false
    default: z-image-turbo
  - name: style
    type: string
    description: Optional style hint (e.g. "flat", "outline", "gradient") appended to the prompt during generation. Does not affect the returned `prompt` field.
    required: false
  - name: output_dir
    type: string
    description: Directory where the generated PNG and SVG files will be saved. Created automatically if it does not exist.
    required: false
returns:
  type: object
  description: JSON result emitted on stdout by the Zikon pipeline.
  properties:
    prompt:
      type: string
      description: The original prompt as supplied by the caller.
    model:
      type: string
      description: The model used for generation.
    seed:
      type: integer
      description: Deterministic seed derived from the prompt (SHA-256 hash), or the value passed via --seed.
    png_path:
      type: string
      description: Absolute path to the generated PNG file.
    svg_path:
      type: string
      description: Absolute path to the generated SVG file.
    svg_inline:
      type: string
      description: Complete inline SVG markup (starts with `<svg`) ready to embed directly in HTML.
user-invokable: true
---

Generate a logo or icon SVG from a plain-English description. Zikon runs the full pipeline — text prompt → PNG via diffusion → SVG via imagetracerjs — and returns a JSON object you can use directly in code or markup.

## Usage

Minimal invocation:

```
/zikon "rocket icon"
```

With optional parameters:

```
/zikon "rocket icon" --model sdxl --style flat --output-dir ./assets/icons
```

## Output Contract

A single JSON object is written to stdout on success:

```json
{
  "prompt": "rocket icon",
  "model": "z-image-turbo",
  "seed": 3471829104,
  "png_path": "/absolute/path/to/output.png",
  "svg_path": "/absolute/path/to/output.svg",
  "svg_inline": "<svg xmlns=\"http://www.w3.org/2000/svg\" ...>...</svg>"
}
```

| Field        | Type    | Description |
|--------------|---------|-------------|
| `prompt`     | string  | Original prompt — unchanged from input. |
| `model`      | string  | Model used for generation. |
| `seed`       | integer | Deterministic seed (SHA-256 of prompt, or caller-supplied). |
| `png_path`   | string  | Absolute path to the generated PNG raster. |
| `svg_path`   | string  | Absolute path to the generated SVG vector. |
| `svg_inline` | string  | Ready-to-embed SVG markup starting with `<svg`. |

## Exit Codes

| Code | Meaning |
|------|---------|
| `0`  | Success |
| `1`  | PNG generation error |
| `2`  | SVG tracing error |
| `3`  | Invalid or missing arguments |

## Examples

### Minimal — generate with defaults

```
/zikon "rocket icon"
```

Returns JSON with `svg_inline` containing a vector rocket icon, PNG and SVG saved to the current working directory.

### With style hint

```
/zikon "coffee cup logo" --style "flat minimal"
```

### Custom output directory

```
/zikon "mountain landscape" --output-dir ./dist/icons
```

### Specific model

```
/zikon "abstract letter A" --model sdxl
```

## Notes

- All log/diagnostic output goes to **stderr**; **stdout** contains only the JSON result.
- `svg_inline` can be pasted directly into HTML without any post-processing.
- The `style` parameter influences generation quality but is not reflected in the `prompt` output field, which always preserves the original input.
