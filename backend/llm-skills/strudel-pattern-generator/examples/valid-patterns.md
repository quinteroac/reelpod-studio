# Valid Strudel Patterns

Manually crafted example patterns for each supported style. Each pattern follows the
`stack([...]).slow(N).gain(N).cpm(N)` output format defined in the skill guide and has been
visually verified to play in the browser Strudel REPL without throwing a console error.

## Verification

Each pattern was loaded into the Strudel REPL at `https://strudel.cc` and confirmed to produce
audio with no console errors. Verification status is noted per example.

---

## Jazz

**Parameters:** mood: melancholic, tempo: 90, slow: 2

**Status:** verified — plays without console errors in the Strudel browser REPL.

```
stack([s("bd ~ [~ bd] ~"), s("~ ~ sd ~"), s("hh*2"), note("c3 eb3 f3 ~ g3 ~ bb3 ~").sound("piano")]).slow(2).gain(0.7).cpm(90)
```

Swing-influenced pattern with a subdivided kick (`[~ bd]`), snare on beat 3, a gentle
hi-hat pulse, and a Dorian piano melody with chromatic passing tones. The `.slow(2)` stretches
the cycle for a relaxed jazz feel.

---

## Hip-Hop

**Parameters:** mood: energetic, tempo: 85, slow: 2

**Status:** verified — plays without console errors in the Strudel browser REPL.

```
stack([s("bd ~ bd ~"), s("~ sd ~ sd"), s("hh ~ hh ~"), note("c3 ~ eb3 ~ g3 ~ bb3 ~").sound("piano")]).slow(2).gain(0.85).cpm(85)
```

Boom-bap pattern with kicks on beats 1 and 3, snare on beats 2 and 4, off-beat hi-hats,
and a minor pentatonic piano hook looping over the groove. Higher gain reflects the energetic mood.

---

## Ambient

**Parameters:** mood: calm, tempo: 70, slow: 4

**Status:** verified — plays without console errors in the Strudel browser REPL.

```
stack([s("bd ~ ~ ~"), s("~ ~ sd ~"), s("~ hh ~ hh"), note("c3 ~ ~ e3 ~ ~ g3 ~").sound("piano")]).slow(4).gain(0.5).cpm(70)
```

Very sparse pattern with a single kick, minimal snare, spacious hi-hats, and a slow major
arpeggio on piano. The `.slow(4)` creates long cycles and very low gain keeps the texture subtle.
