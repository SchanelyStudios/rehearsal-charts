"use client";

import { Button, Checkbox, Field, Label } from "@headlessui/react";
import { Check, ChevronDown, FileMusic, FileUp, Music2, Printer, RotateCcw, Scissors, SlidersHorizontal } from "lucide-react";
import { type ChangeEvent, type CSSProperties, useLayoutEffect, useMemo, useRef, useState } from "react";
import { demo } from "../lib/demo";
import { type Chart, type Chord, type Measure, keys, parseMusicXML, pitch, transpose } from "../lib/music";

const paperSizes = { letter: { width: 816, height: 1056, css: "letter" }, a4: { width: 793.7, height: 1122.5, css: "A4" } };
const initial = { perLine: 0, lyricSize: 13, chordSize: 16, margin: 0.55, paper: "letter" as keyof typeof paperSizes, numbers: true, cues: true };

type Row = { start: number; widths: number[] };

function chordText(chord: Chord, shift: number, flats: boolean) {
  return transpose(chord.root, shift, flats) + chord.suffix + (chord.bass ? "/" + transpose(chord.bass, shift, flats) : "");
}

function Select({ label, value, onChange, children }: {
  label: string; value: string | number; onChange: (value: string) => void; children: React.ReactNode;
}) {
  return <label className="setting"><span>{label}</span><span className="select-wrap">
    <select value={value} onChange={event => onChange(event.target.value)}>{children}</select><ChevronDown size={15} />
  </span></label>;
}

export default function Editor() {
  const [chart, setChart] = useState<Chart>(demo);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [target, setTarget] = useState("");
  const [verse, setVerse] = useState("");
  const [settings, setSettings] = useState(initial);
  const [breaks, setBreaks] = useState<Record<number, "line" | "page">>({});
  const [boundary, setBoundary] = useState("1");
  const [fit, setFit] = useState(1);
  const [measureWidths, setMeasureWidths] = useState<number[]>([]);
  const [pageRows, setPageRows] = useState<Row[][]>([]);
  const xml = useRef("");
  const upload = useRef<HTMLInputElement>(null);
  const importSequence = useRef(0);
  const canvas = useRef<HTMLDivElement>(null);
  const widthProbe = useRef<HTMLDivElement>(null);
  const measurement = useRef<HTMLDivElement>(null);
  const paper = paperSizes[settings.paper];
  const margin = settings.margin * 96;
  const shift = target ? (pitch(target) - pitch(chart.key?.tonic ?? "C") + 12) % 12 : 0;
  const preferFlats = target.includes("♭") || ["F","D♭","E♭","A♭","B♭"].includes(target);
  const tonic = target || chart.key?.tonic;
  const setting = <K extends keyof typeof initial>(key: K, value: (typeof initial)[K]) => setSettings(previous => ({ ...previous, [key]: value }));

  const contentWidth = paper.width - 2 * margin;

  const rows = useMemo(() => {
    const result: Row[] = [];
    let row: Row | undefined;
    let used = 0;
    for (const [index, measure] of chart.measures.entries()) {
      const width = Math.min(contentWidth, measureWidths[index] ?? 150);
      const atLimit = settings.perLine > 0 && row?.widths.length === settings.perLine;
      if (!row || atLimit || used + width > contentWidth || measure.section.length || breaks[index]) {
        row = { start: index, widths: [] };
        result.push(row);
        used = 0;
      }
      row.widths.push(width);
      used += width;
    }
    return result;
  }, [chart, breaks, contentWidth, measureWidths, settings.perLine]);

  useLayoutEffect(() => {
    const probe = widthProbe.current;
    if (!probe) return;
    // Round up and leave room for the closing barline on any measure.
    setMeasureWidths(Array.from(probe.children, element => Math.ceil(element.getBoundingClientRect().width) + 1));
  }, [chart, verse, shift, preferFlats, settings.chordSize, settings.lyricSize, settings.cues, settings.numbers]);

  useLayoutEffect(() => {
    const canvasElement = canvas.current;
    if (!canvasElement) return;
    const observer = new ResizeObserver(([entry]) => setFit(Math.min(1, entry.contentRect.width / paper.width)));
    observer.observe(canvasElement);
    return () => observer.disconnect();
  }, [paper.width]);

  useLayoutEffect(() => {
    const root = measurement.current;
    if (!root) return;
    const paginate = () => {
      const header = root.firstElementChild?.getBoundingClientRect().height ?? 0;
      const heights = Array.from(root.querySelectorAll(".chart-row"), element => element.getBoundingClientRect().height);
      const pages: Row[][] = [[]];
      let used = header;
      const capacity = paper.height - 2 * margin - 32;
      rows.forEach((row, index) => {
        if (pages.at(-1)!.length && (breaks[row.start] === "page" || used + heights[index] > capacity)) {
          pages.push([]);
          used = 34;
        }
        pages.at(-1)!.push(row);
        used += heights[index];
      });
      setPageRows(pages);
    };
    paginate();
    const observer = new ResizeObserver(paginate);
    observer.observe(root);
    return () => observer.disconnect();
  }, [rows, breaks, paper, margin, chart, target, verse, settings]);

  function load(next: Chart) {
    setChart(next);
    setTarget("");
    setVerse("");
    setBreaks({});
    setBoundary("1");
  }

  async function readFile(file?: File) {
    if (!file) return;
    const sequence = ++importSequence.current;
    try {
      const input = await file.text();
      if (sequence !== importSequence.current) return;
      const imported = parseMusicXML(input);
      xml.current = input;
      load(imported);
      setFileName(file.name);
      setError("");
    } catch (problem) {
      if (sequence !== importSequence.current) return;
      setError(problem instanceof Error ? problem.message : "Could not read this file.");
    }
  }

  function onFile(event: ChangeEvent<HTMLInputElement>) {
    void readFile(event.currentTarget.files?.[0]);
    event.currentTarget.value = "";
  }

  const chartStyle = {
    "--paper-width": paper.width + "px", "--paper-height": paper.height + "px",
    "--margin": margin + "px", "--lyric-size": settings.lyricSize + "px",
    "--chord-size": settings.chordSize + "px", "--fit": fit
  } as CSSProperties;

  function chartHeader() {
    return <div className="song-heading">
      <div className="song-kicker">Chord chart</div>
      <h1>{chart.title}</h1>
      {chart.credit && <div className="credit">{chart.credit}</div>}
      {(tonic || chart.time) && <div className="song-meta">
        {tonic && <span><b>Key</b> {tonic} {chart.key?.mode ?? "major"}</span>}
        {chart.time && <span><b>Time</b> {chart.time}</span>}
      </div>}
    </div>;
  }

  function renderMeasure(measure: Measure, index: number) {
    const verses = verse ? [verse] : chart.verses.filter(id => measure.events.some(event => event.lyrics[id]));
    return <div className="measure" key={index} data-measure={measure.number}>
      <div className="measure-marks">
        {measure.section.map((section, i) => <strong className="section-mark" key={i}>{section}</strong>)}
        {measure.ending && <span className="ending">{measure.ending}</span>}
      </div>
      <div className="measure-meta">
        {settings.numbers && <span className="measure-number">{measure.number}</span>}
        {measure.leftRepeat && <b aria-label="Start repeat">{measure.leftRepeat}</b>}
        {index > 0 && measure.time && <b>{measure.time}</b>}
        {index > 0 && measure.key && <b>Key {transpose(measure.key.tonic, shift, preferFlats)}{measure.key.mode === "minor" ? "m" : ""}</b>}
        {measure.rightRepeat && <b className="end-repeat" aria-label={"End repeat " + measure.rightRepeat}>{measure.rightRepeat}</b>}
      </div>
      <div className="events">
        {measure.events.map(event => <div className="event" key={event.beat}>
          <div className="chord">{event.chord && chordText(event.chord, shift, preferFlats)}</div>
          {verses.map(id => <div className="lyric" key={id}>{event.lyrics[id]}</div>)}
        </div>)}
      </div>
      {settings.cues && measure.cues.length > 0 && <div className="cues">{measure.cues.join(" · ")}</div>}
    </div>;
  }

  function renderRow(row: Row) {
    return <div className="chart-row" key={row.start}>
      <div className="measure-grid" style={{ gridTemplateColumns: row.widths.map(width => width + "px").join(" ") }}>
        {row.widths.map((_, column) => {
          const index = row.start + column;
          const measure = chart.measures[index];
          return measure && renderMeasure(measure, index);
        })}
      </div>
    </div>;
  }

  const pages = pageRows.length ? pageRows : [rows];

  return <div className="app">
    <header className="topbar">
      <div className="brand"><span className="brand-icon"><Music2 size={21} /></span><span>Rehearsal<span className="brand-accent">Chart</span></span></div>
      <Button className="print-button" onClick={() => window.print()}><Printer size={17} /> Print chart</Button>
    </header>
    <div className="workspace">
      <aside className="sidebar">
        <section className="panel">
          <h2><FileMusic size={17} /> Score</h2>
          <div className="file-card"><FileMusic size={19} /><div><strong>{chart.title}</strong><span>{fileName || "Example score"}</span></div></div>
          <input ref={upload} type="file" accept=".musicxml,.xml,application/xml,text/xml" onChange={onFile} hidden />
          <Button className="upload-button" onClick={() => upload.current?.click()}
            onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); void readFile(event.dataTransfer.files[0]); }}>
            <FileUp size={17} /> Upload MusicXML
          </Button>
          {error && <p role="alert" className="error">{error}</p>}
          {chart.parts.length > 1 && <Select label="Score part" value={chart.partId} onChange={id => load(parseMusicXML(xml.current, id))}>
            {chart.parts.map(part => <option key={part.id} value={part.id}>{part.name}</option>)}
          </Select>}
          {chart.verses.length > 1 && <Select label="Lyrics" value={verse} onChange={setVerse}>
            <option value="">All verses</option>{chart.verses.map(id => <option key={id} value={id}>Verse {id}</option>)}
          </Select>}
          <Select label="Transpose to" value={target} onChange={setTarget}>
            <option value="">{chart.key ? chart.key.tonic + " · original" : "Original (unknown key)"}</option>
            {chart.key && keys.filter(key => key !== chart.key?.tonic).map(key => <option key={key}>{key}</option>)}
          </Select>
        </section>

        <section className="panel">
          <h2><SlidersHorizontal size={17} /> Layout</h2>
          <div className="settings-grid">
            <Select label="Max. measures per line" value={settings.perLine} onChange={value => setting("perLine", Number(value))}>
              <option value="0">Fit lyrics</option>
              {[1,2,3,4,5,6].map(value => <option key={value}>{value}</option>)}
            </Select>
            <Select label="Paper size" value={settings.paper} onChange={value => setting("paper", value as keyof typeof paperSizes)}>
              <option value="letter">US Letter</option><option value="a4">A4</option>
            </Select>
            <Select label="Chord size" value={settings.chordSize} onChange={value => setting("chordSize", Number(value))}>
              {[12,14,16,18,20,22].map(value => <option key={value} value={value}>{value} px</option>)}
            </Select>
            <Select label="Lyric size" value={settings.lyricSize} onChange={value => setting("lyricSize", Number(value))}>
              {[10,11,12,13,14,15,16,18].map(value => <option key={value} value={value}>{value} px</option>)}
            </Select>
          </div>
          <Select label="Print margins" value={settings.margin} onChange={value => setting("margin", Number(value))}>
            <option value="0.4">Narrow · 0.4″</option><option value="0.55">Standard · 0.55″</option><option value="0.75">Wide · 0.75″</option>
          </Select>
          <div className="toggles">
            <Field className="toggle"><Checkbox className="check" checked={settings.numbers} onChange={value => setting("numbers", value)}>{settings.numbers && <Check size={13} />}</Checkbox><Label>Measure numbers</Label></Field>
            <Field className="toggle"><Checkbox className="check" checked={settings.cues} onChange={value => setting("cues", value)}>{settings.cues && <Check size={13} />}</Checkbox><Label>Performance cues</Label></Field>
          </div>
        </section>

        <section className="panel breaks-panel">
          <h2><Scissors size={17} /> Breaks</h2>
          {chart.measures.length > 1 && <div className="settings-grid">
            <Select label="Before measure" value={boundary} onChange={setBoundary}>
              {chart.measures.slice(1).map((measure, index) => <option value={index + 1} key={index}>{measure.number}{breaks[index + 1] ? " · " + breaks[index + 1] : ""}</option>)}
            </Select>
            <Select label="Break type" value={breaks[Number(boundary)] || ""} onChange={value => {
              setBreaks(previous => {
                const next = { ...previous };
                if (value === "line" || value === "page") next[Number(boundary)] = value;
                else delete next[Number(boundary)];
                return next;
              });
            }}>
              <option value="">Automatic</option><option value="line">New line</option><option value="page">New page</option>
            </Select>
          </div>}
          <Button className="reset-button" onClick={() => { setSettings(initial); setBreaks({}); }}><RotateCcw size={14} /> Reset layout</Button>
        </section>
      </aside>
      <main className="preview" style={chartStyle}>
        <div className="preview-bar"><strong>Chart preview</strong><span>{chart.measures.length} measures <span className="separator">·</span> {pages.length} {pages.length === 1 ? "page" : "pages"}</span></div>
        <div className="canvas" ref={canvas}>
          <div className="measurement" ref={measurement} aria-hidden="true">{chartHeader()}{rows.map(renderRow)}<div ref={widthProbe} className="measure-widths">{chart.measures.map(renderMeasure)}</div></div>
          <div className="sheets">
            {pages.map((page, index) => <article className="sheet" key={index} aria-label={"Page " + (index + 1)}>
              {index === 0 ? chartHeader() : <div className="continuation">{chart.title}</div>}
              {page.map(renderRow)}
              <footer><span>{chart.title}</span><span>{index + 1} / {pages.length}</span></footer>
            </article>)}
          </div>
        </div>
        <style>{`@page { size: ${paper.css}; margin: 0; }`}</style>
      </main>
    </div>
  </div>;
}
