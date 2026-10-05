# Examples — a finished course to compare your work with

[course-from-slides/](course-from-slides/) is a small, complete course made from a six-slide
presentation: every file as it stands when production runs. It passes every check. Use it to see
what a file looks like, not as text to copy.

| File | Shows |
|---|---|
| [treatment.json](course-from-slides/treatment.json) | the slide list approved at gate 3: a row per slide, a slide that feeds two places, a picture left out with a reason |
| [sections/sec-kilder.nb.md](course-from-slides/sections/sec-kilder.nb.md) | one section's text: cards with icons, a prompt, a picture, a table. `sections/` holds each section in each language |
| [sections/sec-arbeidsgang.nb.md](course-from-slides/sections/sec-arbeidsgang.nb.md) | a figure with a line of explanation per step, and a highlighted box |
| [package.json](course-from-slides/package.json) | the package: two sections, a multiple-choice module and the course, in three languages, with texts, pictures and figures pointing at their files |
| [course-state.json](course-from-slides/course-state.json) | what the author approved, with what must survive |
| [figures/arbeidsgang.json](course-from-slides/figures/arbeidsgang.json) | a flow described for `draw-flow-figure.mjs`; `arbeidsgang-nn.json` and `arbeidsgang-en.json` are the translated copies |
| `figures/*.svg` | the drawings the script made: wide and narrow, per language |
| `deck/icons/`, `deck/images/` | icons and a picture as `pptx-extract.mjs` writes them |

To see the checks run:

```
node scripts/slide-coverage.mjs examples/course-from-slides/treatment.json examples/course-from-slides/package.json
node scripts/produce-course.mjs examples/course-from-slides/package.json --out work/example.json --state examples/course-from-slides/course-state.json --slides examples/course-from-slides/treatment.json
```
