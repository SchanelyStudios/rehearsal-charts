import type { Chart, Event } from "./music";

const lines = [
  ["Intro", "G", "", "D/F♯", "", "Em7", "", "Cadd9", ""],
  ["Verse 1", "G", "Morning|light|across", "D/F♯", "the|water", "Em7", "Quiet|roads|are", "Cadd9", "waking|slow"],
  ["", "G", "Every|step|a", "D", "little|farther", "Cadd9", "Every|turn|a", "D", "place|to|go"],
  ["Chorus", "G", "Follow|the|light", "D", "into|the|open", "Em7", "Let|the|river", "Cadd9", "lead|us|home"],
  ["", "G", "Carry|the|sound", "D", "over|the|mountain", "Cadd9", "We|can|find|our", "G", "way|back|home"],
  ["Bridge", "Em7", "When|the|night|falls", "Cadd9", "we|will|stay", "G", "With|the|rhythm", "D", "of|the|day"],
  ["Outro", "G", "", "D/F♯", "", "Cadd9", "", "G", ""],
];

export const demo: Chart = {
  title: "Follow the Light", credit: "", key: { tonic: "G", mode: "major" }, time: "4/4",
  partId: "demo", parts: [{ id: "demo", name: "Lead sheet" }], verses: ["1"],
  measures: lines.flatMap(([section, ...items], row) => Array.from({ length: 4 }, (_, column) => {
    const [symbol, words] = items.slice(column * 2, column * 2 + 2);
    const [root, suffix, bass] = symbol.match(/^([A-G][♯♭]?)([^/]*)(?:\/(.*))?$/)!.slice(1);
    const events: Event[] = (words ? words.split("|") : [""]).map<Event>((word, beat) => ({
      beat, chord: beat === 0 ? { root, suffix, bass } : undefined, lyrics: Object.fromEntries(word ? [["1", word]] : [])
    }));
    return {
      number: String(row * 4 + column + 1), events, section: column === 0 && section ? [section] : [],
      cues: row === 0 && column === 0 ? ["Gently, in time"] : []
    };
  }))
};
