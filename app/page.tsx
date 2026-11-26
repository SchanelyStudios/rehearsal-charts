"use client";

import { Button, Checkbox, Field, Label, Popover, PopoverButton, PopoverGroup, PopoverPanel } from "@headlessui/react";
import { Check, ChevronDown, FileUp, CircleHelp, Music2, Palette, Printer, RotateCcw, SlidersHorizontal } from "lucide-react";
import { type ChangeEvent, type CSSProperties, type KeyboardEvent, useLayoutEffect, useMemo, useRef, useState } from "react";
import { demo } from "../lib/demo";
import { type Chart, type Chord, type Measure, keys, parseMusicXML, pitch, transpose } from "../lib/music";

const paperSizes = { letter: { width: 816, height: 1056, css: "letter" }, a4: { width: 793.7, height: 1122.5, css: "A4" } };
type BeatTicks = "always" | "never" | "without-lyrics";
const chartColors = { measureColor: "#666666", chordColor: "#000000", lyricColor: "#333333", rehearsalColor: "#666666", cueColor: "#666666" };
const initial = { ...chartColors, beatTicks: "without-lyrics" as BeatTicks, lyricSize: 13, chordSize: 16, rehearsalSize: 12, cueSize: 11, margin: 0.55, paper: "letter" as keyof typeof paperSizes, numbers: true, cues: true };

type Row = { start: number; widths: number[] };
type MeasureLayout = { width: number; slots: number[] };

function readMeasureLayout(measure: Element): MeasureLayout {
  const flow = measure.querySelector<HTMLElement>(".event-flow")!;
  const events = Array.from(flow.children);
  const laneEnds: number[] = [];
  const starts: number[] = [];
  let nextBeat = 0;
  let contentEnd = 0;

  for (const event of events) {
    const widths = Array.from(event.querySelectorAll(".chord, .lyric"), lane => lane.getBoundingClientRect().width);
    let start = nextBeat;
    widths.forEach((width, lane) => {
      if (width > 0) start = Math.max(start, laneEnds[lane] ?? 0);
    });
    widths.forEach((width, lane) => {
      if (width === 0) return;
      laneEnds[lane] = start + width + 5;
      contentEnd = Math.max(contentEnd, laneEnds[lane]);
    });
    starts.push(start);
    nextBeat = start + Number(event.getAttribute("data-beat-space"));
  }

  const end = Math.max(nextBeat, contentEnd);
  const slots = starts.map((start, index) => (starts[index + 1] ?? end) - start);
  const meta = measure.querySelector(".measure-meta")!.getBoundingClientRect().width;
  const repeat = measure.querySelector(".repeat-end")?.getBoundingClientRect().width ?? 0;
  const padding = getComputedStyle(flow);
  const rhythmWidth = end + meta + repeat + parseFloat(padding.paddingLeft) + parseFloat(padding.paddingRight);
  // Round up and leave room for the closing barline.
  return { width: Math.ceil(Math.max(measure.getBoundingClientRect().width, rhythmWidth)) + 1, slots };
}

type Fragment = { measureIndex: number; start: number; end: number; continuation: boolean };
const lyricPosition = (measure: number, event: number) => measure + ":" + event;
const eventPosition = (measure: number, event: number, beat: number) =>
  beat === 0 ? lyricPosition(measure, 0) : lyricPosition(measure, event) + (event === 0 ? ":offbeat" : "");
type BreakType = "line" | "page";
const lyricBreakType = (breaks: ReadonlySet<string>, position: string): BreakType | undefined =>
  breaks.has(position + ":page") ? "page" : breaks.has(position) ? "line" : undefined;
const breakLabel = (type: BreakType | undefined) =>
  type === "page" ? "Page break before " : type === "line" ? "Line break before " : "Break position before ";


// MusicXML positions are measured in quarter notes, including in compound meters.
function measureRhythm(measure: Measure, meter: string) {
  const slots = new Map<number, { beat: number; slash?: boolean; eventIndex?: number }>();
  let duration = 0;
  for (const [, groups, denominator] of meter.matchAll(/(\d+(?:\s*\+\s*\d+)*)\s*\/\s*(\d+)/g)) {
    const count = groups.split("+").reduce((sum, group) => sum + Number(group), 0);
    const step = 4 / Number(denominator);
    if (!Number.isFinite(step)) continue;
    for (let beat = 0; beat < count; beat++) {
      const position = Math.round((duration + beat * step) * 10000) / 10000;
      if (measure.pickupDuration !== undefined && position >= measure.pickupDuration) break;
      slots.set(position, { beat: position, slash: true });
    }
    duration += count * step;
  }
  measure.events.forEach(({ beat }, eventIndex) => {
    slots.set(beat, { ...slots.get(beat), beat, eventIndex });
  });
  return { slots: [...slots.values()].sort((a, b) => a.beat - b.beat), duration: measure.pickupDuration ?? duration };
}

function renderChordNote(note: string) {
  const match = /^([A-G])([♭♯]+)$/.exec(note);
  return match ? <>{match[1]}<span className="chord-accidental" data-flat={match[2].startsWith("♭") || undefined}>{match[2]}</span></> : note;
}

function renderChord(chord: Chord, shift: number, flats: boolean) {
  const minor = /^m(?!aj)/.test(chord.suffix) ? "m" : "";
  const detail = chord.suffix.slice(minor.length);
  return <>
    {renderChordNote(transpose(chord.root, shift, flats))}{minor}
    {detail && <sup className="chord-detail">{detail}</sup>}
    {chord.bass && <>/{renderChordNote(transpose(chord.bass, shift, flats))}</>}
  </>;
}

function Select({ label, value, onChange, children, inline = false }: {
  label: string; value: string | number; onChange: (value: string) => void; children: React.ReactNode; inline?: boolean;
}) {
  return <label className={inline ? "setting setting-inline" : "setting"}><span>{label}</span><span className="select-wrap">
    <select value={value} onChange={event => onChange(event.target.value)}>{children}</select><ChevronDown size={15} />
  </span></label>;
}

function ChartFlyout({ label, icon, iconOnly = false, children }: {
  label: string; icon: React.ReactNode; iconOnly?: boolean; children: React.ReactNode;
}) {
  return <Popover>
    <PopoverButton className="toolbar-button" aria-label={label}>
      {icon}{!iconOnly && <>{label}<ChevronDown size={13} /></>}
    </PopoverButton>
    <PopoverPanel anchor={{ to: "bottom end", gap: 8, padding: 12 }} className="toolbar-flyout">
      {children}
    </PopoverPanel>
  </Popover>;
}

function RehearsalMarks({ marks, measure, canAdd, onChange }: {
  marks: string[]; measure: string; canAdd: boolean; onChange: (marks: string[]) => void;
}) {
  const [edit, setEdit] = useState<{ index: number; text: string }>();

  function save() {
    if (!edit) return;
    const text = edit.text.trim();
    setEdit(undefined);
    if (!text || marks[edit.index] === text) return;
    const next = [...marks];
    next[edit.index] = text;
    onChange(next);
  }

  return <div className="rehearsal-marks-editor" onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) save();
  }}>
    {marks.map((mark, index) => <span className="section-mark" key={index}>
      <button type="button" className="rehearsal-label" aria-label={"Edit rehearsal mark " + mark}
        onClick={() => setEdit({ index, text: mark })}>{mark}</button>
    </span>)}
    {(canAdd || edit) && <div className="rehearsal-actions">
      {edit ? <>
        <input className="rehearsal-field" aria-label={"Rehearsal mark for measure " + measure}
          autoFocus value={edit.text} onChange={event => setEdit({ ...edit, text: event.target.value })}
          onKeyDown={event => {
            if (event.key === "Enter") { event.preventDefault(); save(); }
            if (event.key === "Escape") { event.preventDefault(); setEdit(undefined); }
          }} />
        {edit.index < marks.length && <button type="button" className="rehearsal-remove"
          aria-label={"Remove rehearsal mark " + marks[edit.index]}
          onKeyDown={event => { if (event.key === "Escape") setEdit(undefined); }}
          onPointerDown={event => event.preventDefault()}
          onClick={() => {
            const index = edit.index;
            setEdit(undefined);
            onChange(marks.filter((_, markIndex) => markIndex !== index));
          }}>×</button>}
      </> : <button type="button" className="rehearsal-add"
        onClick={() => setEdit({ index: marks.length, text: "" })}>Add rehearsal mark</button>}
    </div>}
  </div>;
}

export default function Editor() {
  const [chart, setChart] = useState<Chart>(demo);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [target, setTarget] = useState("");
  const [verse, setVerse] = useState("");
  const [settings, setSettings] = useState(initial);
  const beatTicks = settings.beatTicks ?? initial.beatTicks;
  const [breaks, setBreaks] = useState<Partial<Record<number, BreakType | "none">>>({});
  const [lyricBreaks, setLyricBreaks] = useState<Set<string>>(() => new Set());
  const [selectedLyric, setSelectedLyric] = useState<string>();
  const restoreLyricFocus = useRef(false);
  const [fit, setFit] = useState(1);
  const [measureLayouts, setMeasureLayouts] = useState<MeasureLayout[]>([]);
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

  const rhythms = useMemo(() => {
    let meter = chart.time ?? "4/4";
    return chart.measures.map(measure => {
      meter = measure.time ?? meter;
      return measureRhythm(measure, meter);
    });
  }, [chart]);

  const fragments = useMemo(() => chart.measures.flatMap(({ events }, measureIndex) => {
    const starts = [0];
    events.forEach(({ beat }, index) => {
      if (beat !== 0 && lyricBreakType(lyricBreaks, eventPosition(measureIndex, index, beat))) starts.push(index);
    });
    return starts.map((start, index): Fragment => ({
      measureIndex, start, end: starts[index + 1] ?? events.length, continuation: index > 0
    }));
  }), [chart, lyricBreaks]);

  function hasRehearsalBreak(index: number) {
    return index > 0 && Boolean(chart.measures[index]?.section.length);
  }

  function measureBreak(index: number): BreakType | undefined {
    const override = breaks[index];
    return override === "none" ? undefined : override ?? (hasRehearsalBreak(index) ? "line" : undefined);
  }

  function setMeasureBreak(index: number, type?: BreakType) {
    setBreaks(previous => {
      const next = { ...previous };
      if (type) next[index] = type;
      else if (hasRehearsalBreak(index)) next[index] = "none";
      else delete next[index];
      return next;
    });
  }

  const rows = useMemo(() => {
    const result: Row[] = [];
    let row: Row | undefined;
    let used = 0;
    for (const [index, fragment] of fragments.entries()) {
      const { measureIndex, continuation } = fragment;
      const forced = continuation || measureBreak(measureIndex);
      const width = measureLayouts[index]?.width ?? 150;
      if (!row || used + width > contentWidth || forced) {
        row = { start: index, widths: [] };
        result.push(row);
        used = 0;
      }
      row.widths.push(width);
      used += width;
    }
    return result;
  }, [chart, fragments, breaks, contentWidth, measureLayouts]);

  useLayoutEffect(() => {
    const probe = widthProbe.current;
    if (!probe) return;
    const measure = () => {
      const layouts = Array.from(probe.children, readMeasureLayout);
      setMeasureLayouts(previous => previous.length === layouts.length &&
        previous.every((layout, index) => layout.width === layouts[index].width &&
          layout.slots?.length === layouts[index].slots.length &&
          layout.slots.every((width, slot) => width === layouts[index].slots[slot])) ? previous : layouts);
    };
    measure();
    const observer = new ResizeObserver(measure);
    probe.querySelectorAll(".measure, .chord, .lyric").forEach(element => observer.observe(element));
    return () => observer.disconnect();
  }, [fragments, verse, shift, preferFlats, settings.chordSize, settings.lyricSize, settings.rehearsalSize, settings.cueSize, settings.cues, settings.numbers]);

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
        const fragment = fragments[row.start];
        const { measureIndex, start, continuation } = fragment;
        const breakType = continuation
          ? lyricBreakType(lyricBreaks, eventPosition(measureIndex, start, chart.measures[measureIndex].events[start].beat))
          : breaks[measureIndex];
        const newPage = breakType === "page";
        if (pages.at(-1)!.length && (newPage || used + heights[index] > capacity)) {
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
  }, [rows, fragments, breaks, lyricBreaks, paper, margin, chart, target, verse, settings]);

  useLayoutEffect(() => {
    if (!restoreLyricFocus.current || !selectedLyric) return;
    const dot = canvas.current?.querySelector<HTMLButtonElement>(`.sheet [data-lyric-dot="${selectedLyric}"]`);
    if (dot) {
      dot.focus();
      restoreLyricFocus.current = false;
    }
  }, [pageRows, selectedLyric]);

  function editLyricBreak(event: KeyboardEvent<HTMLButtonElement>, position: string) {
    if (position === "0:0") return;
    const enter = event.key === "Enter";
    if (!enter && event.key !== "Backspace" && event.key !== "Delete") return;
    event.preventDefault();
    if (event.repeat) return;
    setSelectedLyric(position);

    const [measure, eventIndex, offbeat] = position.split(":");
    const measureIndex = Number(measure);
    const atBarline = eventIndex === "0" && !offbeat;
    const current = atBarline ? measureBreak(measureIndex) : lyricBreakType(lyricBreaks, position);
    const pageBreak = enter && (event.metaKey || event.ctrlKey);
    const nextType = pageBreak ? "page" : enter && !current ? "line" : undefined;
    if (nextType === current) return;

    restoreLyricFocus.current = true;
    if (atBarline) {
      setMeasureBreak(measureIndex, nextType);
    } else {
      setLyricBreaks(previous => {
        const next = new Set(previous);
        next.delete(position);
        next.delete(position + ":page");
        if (nextType) next.add(nextType === "page" ? position + ":page" : position);
        return next;
      });
    }
  }

  function load(next: Chart) {
    setChart(next);
    setTarget("");
    setVerse("");
    setBreaks({});
    setLyricBreaks(new Set());
    setSelectedLyric(undefined);
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
    "--chord-size": settings.chordSize + "px", "--fit": fit,
    "--measure-color": settings.measureColor ?? chartColors.measureColor,
    "--chord-color": settings.chordColor ?? chartColors.chordColor,
    "--lyric-color": settings.lyricColor ?? chartColors.lyricColor,
    "--rehearsal-color": settings.rehearsalColor ?? chartColors.rehearsalColor,
    "--rehearsal-size": (settings.rehearsalSize ?? initial.rehearsalSize) + "px",
    "--cue-color": settings.cueColor ?? chartColors.cueColor,
    "--cue-size": (settings.cueSize ?? initial.cueSize) + "px"
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

  function renderMeasure({ measureIndex: index, start, end, continuation }: Fragment, interactive = false, layout?: MeasureLayout) {
    const measure = chart.measures[index];
    const first = !continuation;
    const last = end === measure.events.length;
    const rhythm = rhythms[index];
    const fragmentStart = first ? -Infinity : measure.events[start].beat;
    const fragmentEnd = last ? Infinity : measure.events[end].beat;
    const slots = rhythm.slots.filter(({ beat }) => beat >= fragmentStart && beat < fragmentEnd);
    const verses = verse ? [verse] : chart.verses.filter(id => measure.events.some(event => event.lyrics[id]));
    const showTicks = beatTicks === "always" || (beatTicks === "without-lyrics" &&
      !measure.events.some(event => verses.some(id => event.lyrics[id])));
    const barPosition = lyricPosition(index, 0);
    const barSelected = selectedLyric === barPosition;
    const barBreak = measureBreak(index);
    return <div className="measure" key={first ? barPosition : eventPosition(index, start, measure.events[start].beat)} data-measure={measure.number} data-continuation={!first || undefined} data-unfinished={!last || undefined}>
      <div className="measure-marks">
        {first && (interactive
          ? <RehearsalMarks marks={measure.section} measure={measure.number} canAdd={barSelected}
              onChange={section => setChart(previous => ({
                ...previous,
                measures: previous.measures.map((item, measureIndex) => measureIndex === index ? { ...item, section } : item)
              }))} />
          : measure.section.map((section, i) => <strong className="section-mark" key={i}>{section}</strong>))}
        {measure.ending && <span className="ending">{measure.ending}</span>}
      </div>
      <div className="measure-track">
        {interactive && first &&
          <button type="button" className="lyric-break-dot barline-break-dot" data-lyric-dot={barPosition}
            data-break={barBreak || undefined} aria-pressed={barSelected}
            aria-label={index === 0 ? "Select barline for measure " + measure.number : breakLabel(barBreak) + "measure " + measure.number}
            onClick={() => setSelectedLyric(barPosition)} onKeyDown={key => editLyricBreak(key, barPosition)} />}
      </div>
      <div className="measure-meta">
        {first && measure.leftRepeat && <span className="repeat-bar repeat-start" role="img" aria-label="Start repeat" />}
        {first && settings.numbers && <span className="measure-number">{measure.number}</span>}
        {first && index > 0 && measure.time && <b>{measure.time}</b>}
        {first && index > 0 && measure.key && <b>Key {transpose(measure.key.tonic, shift, preferFlats)}{measure.key.mode === "minor" ? "m" : ""}</b>}
      </div>
      {last && measure.rightRepeat && <span className="repeat-bar repeat-end" role="img"
          aria-label={"End repeat " + measure.rightRepeat}>
          {measure.rightRepeat.replace(/^𝄇\s*/, "")}
        </span>}
      <div className="events">
        <div className="event-flow">
          {slots.map(({ beat, slash, eventIndex }, slotIndex) => {
            const event = eventIndex === undefined ? undefined : measure.events[eventIndex];
            const position = eventIndex === undefined ? "" : eventPosition(index, eventIndex, beat);
            const nextBeat = slots[slotIndex + 1]?.beat ?? (last ? rhythm.duration : fragmentEnd);
            const space = Math.max(0, (nextBeat - beat) * 24);
            const width = layout?.slots?.[slotIndex] ?? space;
            const lyricBreak = lyricBreakType(lyricBreaks, position);
            const selected = selectedLyric === position;
            const lyric = verses.map(id => event?.lyrics[id]).find(Boolean);
            const atBarline = beat === 0;
            const editable = interactive && position !== "0:0" && Boolean(lyric || lyricBreak);
            return <div className="event" key={beat} style={{ width }} data-beat-space={space}
              data-lyric-selected={selected || undefined} data-at-barline={atBarline || undefined}>
              {editable && !atBarline && <button type="button" className="lyric-break-dot" data-lyric-dot={position}
                data-break={lyricBreak} aria-pressed={selected}
                aria-label={breakLabel(lyricBreak) + (lyric || "this beat")}
                onClick={() => setSelectedLyric(position)} onKeyDown={key => editLyricBreak(key, position)} />}
              <div className="chord">{event?.chord && renderChord(event.chord, shift, preferFlats)}</div>
              {showTicks && slash && <span className="beat-slash" aria-hidden="true">/</span>}
              {verses.map(id => <div className="lyric" key={id}>
                {editable && event?.lyrics[id]
                  ? <button type="button" className="lyric-control" aria-pressed={selected}
                      onClick={() => setSelectedLyric(position)} onKeyDown={key => editLyricBreak(key, position)}>
                      {event.lyrics[id]}
                    </button>
                  : event?.lyrics[id]}
              </div>)}
            </div>;
          })}
        </div>
      </div>
      {last && settings.cues && measure.cues.length > 0 && <div className="cues">{measure.cues.join(" · ")}</div>}
    </div>;
  }

  function renderRow(row: Row, interactive = false) {
    return <div className="chart-row" key={row.start}>
      <div className="measure-grid" style={{ gridTemplateColumns: row.widths.map(width => width + "px").join(" ") }}>
        {row.widths.map((_, column) => {
          const index = row.start + column;
          const fragment = fragments[index];
          return fragment && renderMeasure(fragment, interactive, measureLayouts[index]);
        })}
      </div>
    </div>;
  }

  const pages = pageRows[0]?.[0] === rows[0] ? pageRows : [rows];

  return <div className="app"
    onPointerDownCapture={event => {
      if (selectedLyric && event.target instanceof Element &&
          !event.target.closest(".lyric-break-dot, .lyric-control, .rehearsal-actions")) {
        setSelectedLyric(undefined);
      }
    }}
    onKeyDown={event => {
      if (event.key !== "Escape" || !selectedLyric) return;
      setSelectedLyric(undefined);
      if (event.target instanceof HTMLButtonElement &&
          event.target.matches(".lyric-break-dot, .lyric-control")) event.target.blur();
    }}>
    <header className="topbar">
      <div className="brand"><span className="brand-icon"><Music2 size={21} /></span><span>Rehearsal<span className="brand-accent">Chart</span></span></div>
      <div className="header-chart">
          <div className="header-chart-name">
            <strong title={chart.title}>{chart.title}</strong>
            {fileName && <span title={fileName}>{fileName}</span>}
          </div>
          <input ref={upload} type="file" accept=".musicxml,.xml,application/xml,text/xml" onChange={onFile} hidden />
          <Button className="upload-button" aria-label="Upload MusicXML" onClick={() => upload.current?.click()}
            onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); void readFile(event.dataTransfer.files[0]); }}>
            <FileUp size={15} /> Upload
          </Button>
        <span className="header-chart-count">{chart.measures.length} measures · {pages.length} {pages.length === 1 ? "page" : "pages"}</span>
      </div>
      <Button className="print-button" onClick={() => window.print()}><Printer size={17} /> Print chart</Button>
    </header>
    <div className="chart-toolbar" role="group" aria-label="Chart controls">
      <div className="toolbar-selects">
        {chart.parts.length > 1 && <Select label="Score part" value={chart.partId} onChange={id => load(parseMusicXML(xml.current, id))}>
          {chart.parts.map(part => <option key={part.id} value={part.id}>{part.name}</option>)}
        </Select>}
        <Select label="Transpose" value={target} onChange={setTarget} inline>
          <option value="">{chart.key ? chart.key.tonic + " · original" : "Original (unknown key)"}</option>
          {chart.key && keys.filter(key => key !== chart.key?.tonic).map(key => <option key={key}>{key}</option>)}
        </Select>
      </div>
      <PopoverGroup className="toolbar-actions">
        <ChartFlyout label="Layout" icon={<SlidersHorizontal size={16} />}>
          {chart.verses.length > 1 && <Select label="Lyrics" value={verse} onChange={setVerse}>
            <option value="">All verses</option>{chart.verses.map(id => <option key={id} value={id}>Verse {id}</option>)}
          </Select>}
          <Select label="Beat ticks" value={beatTicks} onChange={value => setting("beatTicks", value as BeatTicks)}>
            <option value="always">Always</option>
            <option value="never">Never</option>
            <option value="without-lyrics">Only in bars without lyrics</option>
          </Select>
          <Select label="Paper size" value={settings.paper} onChange={value => setting("paper", value as keyof typeof paperSizes)}>
            <option value="letter">US Letter</option><option value="a4">A4</option>
          </Select>
          <Select label="Print margins" value={settings.margin} onChange={value => setting("margin", Number(value))}>
            <option value="0.4">Narrow · 0.4″</option><option value="0.55">Standard · 0.55″</option><option value="0.75">Wide · 0.75″</option>
          </Select>
          <div className="toggles">
            <Field className="toggle"><Checkbox className="check" checked={settings.numbers} onChange={value => setting("numbers", value)}>{settings.numbers && <Check size={13} />}</Checkbox><Label>Measure numbers</Label></Field>
            <Field className="toggle"><Checkbox className="check" checked={settings.cues} onChange={value => setting("cues", value)}>{settings.cues && <Check size={13} />}</Checkbox><Label>Performance cues</Label></Field>
          </div>
        </ChartFlyout>
        <ChartFlyout label="Chart styles" icon={<Palette size={16} />}>
          <fieldset className="chart-styles">
            <legend>Chart styles</legend>
            <div className="chart-style-grid">
              <div className="chart-style-headings" aria-hidden="true"><span></span><span>Size</span><span>Color</span></div>
            {([
              ["chordColor", "Chords", "chordSize", [12,14,16,18,20,22]],
              ["lyricColor", "Lyrics", "lyricSize", [10,11,12,13,14,15,16,18,20,22]],
              ["rehearsalColor", "Rehearsal marks", "rehearsalSize", [10,11,12,13,14,16,18,20,22]],
              ["cueColor", "Performance cues", "cueSize", [10,11,12,13,14,16,18,20,22]],
              ["measureColor", "Measures and repeats", undefined, []]
            ] as const).map(([key, label, sizeKey, sizes]) => {
              const color = settings[key] ?? chartColors[key];
              return <div className="chart-style-row" key={key}>
                <label htmlFor={key}>{label}</label>
                {sizeKey ? <select aria-label={label + " size"} value={settings[sizeKey] ?? initial[sizeKey]}
                  onChange={event => setting(sizeKey, Number(event.target.value))}>
                  {sizes.map(value => <option key={value} value={value}>{value} px</option>)}
                </select> : <span className="chart-style-no-size" aria-hidden="true">—</span>}
                <div className="color-inputs">
                  <input id={key} type="color" value={color} onInput={event => setting(key, event.currentTarget.value)} />
                  <input key={color} type="text" aria-label={label + " hex color"} defaultValue={color}
                    maxLength={7} spellCheck={false}
                    onBlur={event => {
                      const hex = event.currentTarget.value.trim().replace(/^#/, "");
                      const updated = /^[0-9a-f]{6}$/i.test(hex) ? "#" + hex.toLowerCase() : color;
                      event.currentTarget.value = updated;
                      setting(key, updated);
                    }}
                    onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }} />
                </div>
              </div>;
            })}
            </div>
          </fieldset>
        </ChartFlyout>
        <ChartFlyout label="Breaks and keyboard shortcuts" icon={<CircleHelp size={18} />} iconOnly>
          <h2>Breaks</h2>
          <p className="break-help">Select a lyric or barline. Press Enter for a line break or Command/Ctrl + Enter for a page break. Press Enter, Backspace, or Delete on a solid dot to remove the break.</p>
          <Button className="reset-button" onClick={() => { setSettings(initial); setBreaks({}); setLyricBreaks(new Set()); setSelectedLyric(undefined); }}><RotateCcw size={14} /> Reset layout</Button>
        </ChartFlyout>
      </PopoverGroup>
      {error && <p role="alert" className="error toolbar-error">{error}</p>}
    </div>
    <main className="preview" style={chartStyle}>
      <div className="canvas" ref={canvas}>
        <div className="measurement" ref={measurement} aria-hidden="true">{chartHeader()}{rows.map(row => renderRow(row))}<div ref={widthProbe} className="measure-widths">{fragments.map(fragment => renderMeasure(fragment))}</div></div>
        <div className="sheets" data-overwide={measureLayouts.some(layout => layout.width > contentWidth) || undefined}>
          {pages.map((page, index) => <article className="sheet" key={index} aria-label={"Page " + (index + 1)}
            style={{ "--preview-page-width": Math.max(paper.width, ...page.map(row =>
              row.widths.reduce((sum, width) => sum + width, 0) + 2 * margin)) + "px" } as CSSProperties}>
            {index === 0 ? chartHeader() : <div className="continuation">{chart.title}</div>}
            {page.map(row => renderRow(row, true))}
            <footer><span>{chart.title}</span><span>{index + 1} / {pages.length}</span></footer>
          </article>)}
        </div>
      </div>
      <style>{`@page { size: ${paper.css}; margin: 0; }`}</style>
    </main>
  </div>;
}
