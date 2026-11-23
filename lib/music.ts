export type Chord = { root: string; suffix: string; bass?: string };
export type Key = { tonic: string; mode: string };
export type Event = { beat: number; chord?: Chord; lyrics: Record<string, string> };
export type Measure = {
  number: string; events: Event[]; section: string[]; cues: string[];
  time?: string; key?: Key; leftRepeat?: string; rightRepeat?: string; ending?: string;
};
export type Chart = {
  title: string; credit: string; key?: Key; time?: string; measures: Measure[];
  verses: string[]; parts: { id: string; name: string }[]; partId: string;
};

const child = (node: Element | undefined, name: string) =>
  Array.from(node?.children ?? []).find(element => element.localName === name);
const all = (node: Element | undefined, name: string) =>
  Array.from(node?.children ?? []).filter(element => element.localName === name);
const value = (node: Element | undefined, name: string) => child(node, name)?.textContent?.trim() ?? "";
const major = ["C♭","G♭","D♭","A♭","E♭","B♭","F","C","G","D","A","E","B","F♯","C♯"];
const minor = ["A♭","E♭","B♭","F","C","G","D","A","E","B","F♯","C♯","G♯","D♯","A♯"];
export const keys = ["C","D♭","D","E♭","E","F","F♯","G","A♭","A","B♭","B"];
const sharps = ["C","C♯","D","D♯","E","F","F♯","G","G♯","A","A♯","B"];
const flats = ["C","D♭","D","E♭","E","F","G♭","G","A♭","A","B♭","B"];

export function pitch(name: string) {
  const natural = sharps.indexOf(name[0]);
  const accidental = Array.from(name.slice(1)).reduce((sum, char) => sum + (char === "♯" ? 1 : char === "♭" ? -1 : 0), 0);
  return (natural + accidental + 12) % 12;
}

export function transpose(name: string, shift: number, preferFlats: boolean) {
  if (!shift || !/^[A-G][♯♭]*$/.test(name)) return name;
  return (preferFlats ? flats : sharps)[(pitch(name) + shift + 12) % 12];
}

const suffixes: Record<string, string> = {
  major:"", minor:"m", dominant:"7", "major-seventh":"maj7", "minor-seventh":"m7",
  augmented:"+", diminished:"dim", "half-diminished":"m7♭5", "diminished-seventh":"dim7",
  "major-sixth":"6", "minor-sixth":"m6", "dominant-ninth":"9", "major-ninth":"maj9",
  "minor-ninth":"m9", "dominant-11th":"11", "dominant-13th":"13", "suspended-second":"sus2",
  "suspended-fourth":"sus4", "power":"5", "major-minor":"m(maj7)"
};

function accidental(alter: string) {
  const count = Number(alter);
  if (count === 2) return "♯♯";
  if (count === -2) return "♭♭";
  return count === 1 ? "♯" : count === -1 ? "♭" : "";
}

function readChord(node: Element): Chord | undefined {
  const kindNode = child(node, "kind");
  const kind = kindNode?.textContent?.trim() ?? "";
  if (kind === "none") return { root: "N.C.", suffix: "" };
  const root = child(node, "root");
  const bass = child(node, "bass");
  const numeral = child(node, "numeral");
  const step = value(root, "root-step");
  const symbol = step ? step + accidental(value(root, "root-alter")) : value(node, "function") || value(numeral, "numeral-root");
  if (!symbol) return;
  const degrees = all(node, "degree").map(degree => {
    const type = value(degree, "degree-type");
    return (type === "subtract" ? "omit " : type === "add" ? "add " : "") +
      accidental(value(degree, "degree-alter")) + value(degree, "degree-value");
  });
  const suffix = (kindNode?.getAttribute("text") || suffixes[kind] || (kind === "major" ? "" : kind)) +
    (degrees.length ? "(" + degrees.join(", ") + ")" : "");
  return { root: symbol, suffix, bass: bass ? value(bass, "bass-step") + accidental(value(bass, "bass-alter")) : undefined };
}

export function parseMusicXML(xml: string, requestedPart?: string): Chart {
  const document = new DOMParser().parseFromString(xml, "application/xml");
  if (document.getElementsByTagName("parsererror").length) throw new Error("This file contains invalid XML.");
  const score = document.documentElement;
  if (score.localName !== "score-partwise") throw new Error("Choose an uncompressed, partwise MusicXML score (.musicxml or .xml).");
  const scoreParts = all(score, "part");
  const names = new Map(all(child(score, "part-list"), "score-part").map(part => [part.getAttribute("id"), value(part, "part-name")]));
  const id = (part: Element) => part.getAttribute("id") ?? "";
  const weight = (part: Element) => part.getElementsByTagName("harmony").length * 3 + part.getElementsByTagName("lyric").length;
  const part = scoreParts.find(part => id(part) === requestedPart) ??
    [...scoreParts].sort((a, b) => weight(b) - weight(a))[0];
  if (!part || !all(part, "measure").length) throw new Error("This score has no measures.");
  const verses = new Set<string>();
  let divisions = 1;
  let activeEnding: string | undefined;
  let previousKey: Key | undefined;
  let previousTime: string | undefined;
  const measures = all(part, "measure").map((element, index): Measure => {
    const measure: Measure = { number: element.getAttribute("number") || String(index + 1), events: [], section: [], cues: [], ending: activeEnding };
    const events = new Map<number, Event>();
    let position = 0;
    let lastNote = 0;
    const eventAt = (beat: number) => {
      const rounded = Math.round(beat * 10000) / 10000;
      const event = events.get(rounded) ?? { beat: rounded, lyrics: Object.create(null) as Record<string, string> };
      events.set(rounded, event);
      return event;
    };
    const sound = (node: Element) => {
      const labels: Record<string, string> = { dacapo:"D.C.", dalsegno:"D.S.", tocoda:"To Coda", fine:"Fine" };
      for (const [attribute, label] of Object.entries(labels)) {
        if (node.hasAttribute(attribute) && node.getAttribute(attribute) !== "no" &&
            !measure.cues.some(cue => cue.toLowerCase().includes(label.toLowerCase()))) measure.cues.push(label);
      }
    };
    for (const node of Array.from(element.children)) {
      switch (node.localName) {
        case "attributes": {
          divisions = Number(value(node, "divisions")) || divisions;
          const key = child(node, "key");
          const fifths = value(key, "fifths");
          if (fifths) {
            const mode = value(key, "mode") || "major";
            const tonic = (mode === "minor" ? minor : major)[Number(fifths) + 7];
            if (tonic && (tonic !== previousKey?.tonic || mode !== previousKey.mode)) measure.key = previousKey = { tonic, mode };
          }
          const time = child(node, "time");
          const beats = all(time, "beats");
          const types = all(time, "beat-type");
          const signature = beats.map((beat, i) => beat.textContent + "/" + types[i]?.textContent).join(" + ");
          if (signature && signature !== previousTime) measure.time = previousTime = signature;
          break;
        }
        case "backup": position -= Number(value(node, "duration")) / divisions; break;
        case "forward": position += Number(value(node, "duration")) / divisions; break;
        case "harmony": {
          const chord = readChord(node);
          if (chord) eventAt(position + Number(value(node, "offset")) / divisions).chord = chord;
          break;
        }
        case "note": {
          const simultaneous = Boolean(child(node, "chord"));
          const start = simultaneous ? lastNote : position;
          for (const lyric of all(node, "lyric")) {
            const text = all(lyric, "text").map(item => item.textContent).join("‿").trim();
            if (!text) continue;
            const verse = lyric.getAttribute("number") || lyric.getAttribute("name") || "1";
            const syllabic = value(lyric, "syllabic");
            eventAt(start).lyrics[verse] ??= text + (["begin","middle"].includes(syllabic) ? "-" : "");
            verses.add(verse);
          }
          if (!simultaneous) {
            lastNote = start;
            position += Number(value(node, "duration")) / divisions;
          }
          break;
        }
        case "direction":
          for (const type of all(node, "direction-type")) {
            for (const mark of Array.from(type.children)) {
              const text = mark.textContent?.trim();
              if (text && (mark.localName === "rehearsal" || (mark.localName === "words" && mark.getAttribute("enclosure") && mark.getAttribute("enclosure") !== "none"))) measure.section.push(text);
              else if (text && mark.localName === "words") measure.cues.push(text);
              else if (mark.localName === "segno") measure.cues.push("Segno");
              else if (mark.localName === "coda") measure.cues.push("Coda");
            }
          }
          all(node, "sound").forEach(sound);
          break;
        case "sound": sound(node); break;
        case "barline": {
          const repeat = child(node, "repeat");
          if (repeat?.getAttribute("direction") === "forward") measure.leftRepeat = "𝄆";
          if (repeat?.getAttribute("direction") === "backward") {
            const times = repeat.getAttribute("times");
            measure.rightRepeat = "𝄇" + (times && times !== "2" ? " ×" + times : "");
          }
          const ending = child(node, "ending");
          if (ending?.getAttribute("type") === "start") {
            activeEnding = (ending.textContent?.trim() || ending.getAttribute("number") || "") + ".";
            measure.ending = activeEnding;
          } else if (ending) {
            activeEnding = undefined;
          }
          break;
        }
      }
    }
    measure.events = [...events.values()].sort((a, b) => a.beat - b.beat);
    return measure;
  });
  return {
    title: value(child(score, "work"), "work-title") || value(score, "movement-title") || "Untitled score",
    credit: value(child(score, "identification"), "creator"),
    key: measures[0].key, time: measures[0].time, measures, verses: [...verses],
    partId: id(part), parts: scoreParts.map(item => ({ id: id(item), name: names.get(item.getAttribute("id")) || id(item) }))
  };
}
