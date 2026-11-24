# Rehearsal Chart

A Next.js, TypeScript, Tailwind CSS, and Headless UI editor for chord charts that follow sheet-music measure numbers.

```sh
npm ci
npm run dev
```

Open http://localhost:3000. The editor starts with an original demo chart. Upload a partwise MusicXML file, check the selected part and lyric verse, then adjust the key, text sizes, and paper settings. Measures size to fit their lyrics and chord symbols. Set a maximum number of measures per line if you want shorter lines. Add line or page breaks from the Breaks panel. Use **Print chart** to print or save a PDF through the browser. Use the matching paper size, 100% scale, and turn off browser headers and footers if enabled.

Files are parsed in the browser. The draft keeps edits in memory until the page reloads. It reads explicit chord symbols from MusicXML, follows written measure order, and displays written navigation without unfolding repeats. The importer supports uncompressed partwise MusicXML. For multi-part scores, the editor defaults to the part with the most lyric and harmony data and lets you switch parts. It does not combine parts or infer chords from notes.

```sh
npm run typecheck
npm run build
```
