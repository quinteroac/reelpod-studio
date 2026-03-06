---
name: create-amv
description: "Use this skill when the user gives a theme, concept, mood, or scene and wants to generate an anime music video (AMV) in ReelPod Studio. Triggers when the user says things like 'create a song about', 'generate music for', 'make a track for', 'I want lofi for studying', or describes any creative scenario that should become a ReelPod Studio generation."
user-invocable: true
---

# Create an Anime Music Video (AMV) in ReelPod Studio

Generate a song with matching anime visuals from a user-supplied theme. You will infer **music parameters** (mood, style, tempo, duration, prompt) and craft a **single unified prompt** used for both the music model and the Anima visual model, then execute the MCP tool calls.

> **STRICT RULE — ONE PROMPT:**
> The value of `prompt` (passed to `set_song_parameters`) and `imagePrompt` (passed to `generate_audio`) **must be exactly the same string**. Write one prompt and reuse it verbatim for both fields. No exceptions.

---

## Your job

1. Read the user's theme or concept.
2. Decide music parameters (see [Music Parameters](#music-parameters)).
3. Write an `imagePrompt` for Anima (see [Image Prompt Guide](#image-prompt-guide)).
4. Call `set_song_parameters`, then `generate_audio`, then `add_to_queue`.

---

## Music Parameters

### Available values

| Parameter | Options | Range |
|-----------|---------|-------|
| `mood` | `chill` · `melancholic` · `upbeat` | — |
| `style` | `jazz` · `hip-hop` · `ambient` | — |
| `tempo` | integer BPM | 60–120 |
| `duration` | seconds | 40–300 |
| `mode` | `parameters` · `text` · `text-and-parameters` | — |
| `prompt` | free text describing the song | only in text modes |

### Mode selection

| When | Use mode |
|------|----------|
| Theme is vibe/atmosphere only (e.g. "lofi for studying") | `parameters` |
| Theme is a specific narrative or lyrical concept | `text-and-parameters` |
| Strict text-to-music, ignoring mood/style params | `text` |

In `text-and-parameters` and `text`, the `prompt` field is sent to the music model. Write a single prompt using **Danbooru tags separated by commas** that describes both the sound and the scene — this same string will be used as `imagePrompt` verbatim. Example: `"anime screenshot, lofi art style, 1girl, solo, bedroom, night, rain on window, warm lamp light, blue and yellow tones, peaceful, slow jazz, vinyl crackle, mellow piano, introspective"`.

> **STRICT RULE:** `prompt` == `imagePrompt`. Always identical.

### Theme → parameters mapping

| Theme / Concept | mood | style | tempo | Notes |
|-----------------|------|-------|-------|-------|
| Studying / focus / lofi | chill | jazz | 70–85 | Long duration (120–240 s) |
| Late night city / urban | chill | hip-hop | 80–90 | — |
| Beach / summer / relax | chill | ambient | 75–85 | — |
| Nature / forest / meditation | chill | ambient | 60–75 | — |
| Sadness / breakup / longing | melancholic | jazz | 65–80 | — |
| Dark / cinematic / dramatic | melancholic | ambient | 60–75 | — |
| Rainy / nostalgic | melancholic | jazz | 70–80 | — |
| Party / energy / hype | upbeat | hip-hop | 95–115 | — |
| Morning / motivation / run | upbeat | hip-hop | 90–105 | — |
| Happy / playful / bright | upbeat | jazz | 85–100 | — |

Use these as a starting point — adjust based on nuance in the user's description.

---

## Unified Prompt Guide

The **single prompt** is used for **both** `set_song_parameters` (music model) and `generate_audio` (Anima visual model). Write it so it evokes both the sound and the scene at once.

> **STRICT RULES:**
> 1. `prompt` and `imagePrompt` must be **exactly the same string**. Copy-paste — no paraphrasing, no variation.
> 2. The prompt **must use Danbooru tags separated by commas**. No full sentences — use comma-separated tag tokens.
> 3. **More tags = better.** The prompt must be as long, descriptive, and detailed as possible. Aim for **20–40 tags minimum**. Cover every visual and sonic dimension.

The backend automatically prepends `score_9, score_8, best quality, highres` to the visual side — **do not repeat those tags**.

### Tag categories to always include

| Category | Example tags |
|----------|-------------|
| **Art style** | `anime screenshot`, `lofi art style`, `digital illustration`, `watercolor`, `cel shading` |
| **Subject / character** | `1girl`, `1boy`, `solo`, `long hair`, `school uniform`, `hoodie`, `looking at viewer` |
| **Scene / setting** | `outdoors`, `indoors`, `night`, `rooftop`, `city`, `forest`, `bedroom`, `train station` |
| **Environment detail** | `neon lights`, `rain`, `cherry blossoms`, `fog`, `stars`, `window`, `street lamp` |
| **Lighting** | `moonlight`, `golden hour`, `soft lighting`, `neon glow`, `rim light`, `candlelight` |
| **Color palette** | `blue theme`, `warm colors`, `pastel colors`, `dark palette`, `pink and cyan`, `desaturated` |
| **Mood / atmosphere** | `melancholic`, `peaceful`, `nostalgic`, `dreamy`, `lonely`, `cozy`, `tense` |
| **Composition** | `wide shot`, `close-up`, `from above`, `dutch angle`, `depth of field`, `bokeh` |
| **Sound descriptors** | `slow piano`, `vinyl crackle`, `deep bass`, `ambient synths`, `lo-fi beats`, `reverb` |
| **Music genre/feel** | `vaporwave`, `lo-fi`, `jazz`, `hip-hop`, `ambient`, `chillwave`, `dreampop` |

### Theme → prompt examples

**Lofi studying**
```
anime screenshot, lofi art style, 1girl, solo, long hair, sitting at desk, books, potted plant, open notebook, pencil, warm lamp light, rain on window, night, indoors, bedroom, cozy room, soft yellow lighting, blue and green tones, peaceful, focused, calm atmosphere, slow jazz, mellow piano, vinyl crackle, soft drums, lo-fi beats, introspective, warm and quiet
```

**Late night city**
```
anime screenshot, digital illustration, 1girl, solo, hood up, standing, looking away, neon-lit alley, rain, wet pavement, reflections, night, city, urban, cyberpunk, neon lights, blue and purple palette, cool tones, soft glow, lonely, melancholic, cinematic composition, wide shot, depth of field, lo-fi hip-hop, slow groove, distant city sounds, muted bass, atmospheric
```

**Beach / summer**
```
digital illustration, anime style, 1girl, solo, long hair, sundress, barefoot, standing on shore, looking at horizon, sunset beach, ocean waves, golden hour, warm light, orange and pink sky, palm trees, silhouette, nostalgic, peaceful, dreamy, warm colors, bokeh, wide shot, ambient guitar, gentle synths, soft percussion, summer lo-fi, breezy and calm
```

**Sadness / breakup**
```
anime screenshot, 1girl, solo, long hair, sitting, knees to chest, empty park bench, cherry blossoms, falling petals, dusk, overcast sky, desaturated colors, cool blue tones, soft backlight, solitude, melancholic, longing, quiet, depth of field, close-up, sad expression, tears, slow piano, soft strings, ambient rain, heartbreak, bittersweet, introspective
```

**Party / hype**
```
digital illustration, anime style, 1girl, 1boy, crowd, dancing, concert stage, colorful spotlights, confetti, night, indoors, vibrant neon colors, dynamic composition, motion blur, energetic, excited, upbeat, bold colors, pink and yellow, wide shot, heavy bass, trap beat, 808s, distorted synths, high energy, festival vibes, hype
```

**Dark / cinematic**
```
anime screenshot, dark fantasy, 1girl, solo, long coat, standing, ancient ruins, night, dramatic moonlight, fog, silhouette, deep blue and grey palette, dark atmosphere, rim light, epic, ominous, mysterious, wide shot, from below, stars, crumbling stone, orchestral ambient, deep drones, slow reverb, tension, cinematic build, dark synths
```

---

## Execution flow

```
UNIFIED_PROMPT = <single prompt used for both music and image>

1. set_song_parameters(
     mood      = <inferred>,
     style     = <inferred>,
     tempo     = <inferred>,
     duration  = <inferred>,
     mode      = <inferred>,
     prompt    = UNIFIED_PROMPT   ← only in text modes
   )

2. generate_audio(
     imagePrompt = UNIFIED_PROMPT  ← MUST be identical to prompt above
   )

3. add_to_queue()   ← always, no exceptions
```

> **STRICT RULE:** `prompt` and `imagePrompt` must be the **exact same string**.

---

## Output to user

After generating, report:
- **Mood / Style / Tempo / Duration** — so the user knows what was inferred
- **Unified prompt used** — so they can refine it next time

---

## Examples

### Example 1 — "I want music for a rainy study session"

```
mood:          chill
style:         jazz
tempo:         78
duration:      180
mode:          parameters
prompt:        (omitted — parameters mode)
imagePrompt:   (omitted — parameters mode; generate_audio called with no imagePrompt)
```

### Example 2 — "Make a sad song about missing someone far away"

```
mood:          melancholic
style:         jazz
tempo:         72
duration:      120
mode:          text-and-parameters
UNIFIED_PROMPT:
  "anime screenshot, 1girl, solo, long hair, dark hair, standing, coat, train station, window,
   watching train leave, platform, dusk, overcast sky, warm fading light, cool desaturated tones,
   blue and grey palette, soft backlight, rim light, depth of field, wide shot, melancholic,
   solitude, longing, nostalgic, quiet atmosphere, sad expression, slow piano, soft strings,
   ambient rain, bittersweet, introspective, heartbreak, gentle reverb, lo-fi jazz"

prompt      = UNIFIED_PROMPT   ← set_song_parameters
imagePrompt = UNIFIED_PROMPT   ← generate_audio (identical)
```

### Example 3 — "Hype track for my workout"

```
mood:          upbeat
style:         hip-hop
tempo:         108
duration:      60
mode:          text-and-parameters
UNIFIED_PROMPT:
  "digital illustration, anime style, 1boy, solo, muscular, tank top, gym, weight lifting,
   barbell, sweat, intense expression, bright lights, indoor, motion blur, dynamic composition,
   from below, red and orange palette, vibrant colors, bold contrast, energetic, intense,
   determined, high energy, heavy bass, trap beat, 808s, distorted synths, motivational,
   fast rhythm, festival vibes, hype, aggressive, punchy drums"

prompt      = UNIFIED_PROMPT   ← set_song_parameters
imagePrompt = UNIFIED_PROMPT   ← generate_audio (identical)
```
