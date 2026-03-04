---
name: create-amv
description: "Use this skill when the user gives a theme, concept, mood, or scene and wants to generate an anime music video (AMV) in ReelPod Studio. Triggers when the user says things like 'create a song about', 'generate music for', 'make a track for', 'I want lofi for studying', or describes any creative scenario that should become a ReelPod Studio generation."
user-invocable: true
---

# Create an Anime Music Video (AMV) in ReelPod Studio

Generate a song with matching anime visuals from a user-supplied theme. You will infer **music parameters** (mood, style, tempo, duration, prompt) and craft an **image prompt** for the Anima visual model, then execute the MCP tool calls.

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

In `text-and-parameters` and `text`, the `prompt` field is sent to the music model. Write it as a concise, evocative description of the sound (not the image). Example: `"slow rainy evening, distant piano, vinyl crackle, introspective"`.

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

## Image Prompt Guide

The `imagePrompt` goes to the **Anima** model (anime/illustration focused). The backend automatically prepends `score_9, score_8, best quality, highres` — **do not repeat those tags**.

### Structure

```
[subject/character] [scene/setting] [lighting] [color palette] [mood tags] [style tags]
```

You can mix tag-style and natural language freely. Aim for at least 2 descriptive phrases.

### Key rules

- **No quality tags** (`score_9`, `best quality`, etc.) — already injected.
- **Use descriptive scene tags**: `night cityscape`, `forest path`, `rain-soaked street`, `starry sky`, `neon lights`.
- **Color palette** shapes the mood: `warm orange tones`, `cool blue palette`, `desaturated colors`, `vibrant pastel`.
- **Lighting** is critical: `soft backlighting`, `moonlight`, `golden hour`, `neon glow`, `candlelight`.
- **Style tags** anchor the aesthetic: `anime screenshot`, `lofi art style`, `digital illustration`, `watercolor`.
- Artist tags format: `@artist_name` (optional, use sparingly).

### Theme → imagePrompt examples

**Lofi studying**
```
anime screenshot, lofi art style, cozy bedroom at night, a student at a desk surrounded by books and plants, warm lamp light, rain on window, soft yellow and green tones, peaceful atmosphere
```

**Late night city**
```
anime screenshot, urban night scene, neon-lit alley, rain reflections on pavement, solitary figure walking, cool blue and purple palette, cyberpunk vibes, soft glow
```

**Beach / summer**
```
digital illustration, sunset beach, golden hour light, ocean waves, silhouette of a person sitting on the sand, warm orange and pink tones, peaceful and nostalgic
```

**Sadness / breakup**
```
anime screenshot, melancholic atmosphere, empty park bench under cherry blossoms at dusk, fallen petals, cool desaturated tones, soft blue light, solitude
```

**Party / hype**
```
digital illustration, concert stage, colorful spotlights, energetic crowd, vibrant neon colors, dynamic composition, upbeat and exciting mood
```

**Nature / meditation**
```
digital illustration, misty forest path at dawn, soft diffused light through trees, calm figure sitting in meditation, green and soft gold palette, serene atmosphere
```

**Dark / cinematic**
```
anime screenshot, dark fantasy atmosphere, ancient ruins at night, dramatic moonlight, lone figure silhouetted against the sky, deep blue and grey palette, epic and ominous mood
```

---

## Execution flow

```
1. set_song_parameters(
     mood      = <inferred>,
     style     = <inferred>,
     tempo     = <inferred>,
     duration  = <inferred>,
     mode      = <inferred>,
     prompt    = <music text if mode != "parameters">
   )

2. generate_audio(
     imagePrompt = <Anima prompt>
   )

3. add_to_queue()   ← always, no exceptions
```

---

## Output to user

After generating, report:
- **Mood / Style / Tempo / Duration** — so the user knows what was inferred
- **Image prompt used** — so they can refine it next time

---

## Examples

### Example 1 — "I want music for a rainy study session"

```
mood:        chill
style:       jazz
tempo:       78
duration:    180
mode:        parameters
imagePrompt: "anime screenshot, lofi art style, student at a wooden desk by a rainy window at night,
              warm desk lamp, scattered notebooks and a coffee mug, soft yellow and deep blue tones,
              cozy and focused atmosphere"
```

### Example 2 — "Make a sad song about missing someone far away"

```
mood:        melancholic
style:       jazz
tempo:       72
duration:    120
mode:        text-and-parameters
prompt:      "longing for someone far away, quiet piano, soft rain, bittersweet memory"
imagePrompt: "anime screenshot, melancholic mood, person standing at a train station window at dusk,
              watching the train leave, warm fading light, cool desaturated tones, solitude and longing"
```

### Example 3 — "Hype track for my workout"

```
mood:        upbeat
style:       hip-hop
tempo:       108
duration:    60
mode:        text-and-parameters
prompt:      "high energy workout, heavy bass, motivational, fast rhythm"
imagePrompt: "digital illustration, dynamic gym scene, person lifting weights under bright lights,
              vibrant red and orange tones, motion blur effect, intense and energetic atmosphere"
```
