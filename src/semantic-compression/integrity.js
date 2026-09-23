export const COMPRESSION_WARNING_CODES = Object.freeze({
  MISSING_NUMERIC_MARKER: "missing_numeric_marker",
  MISSING_PERCENTAGE_MARKER: "missing_percentage_marker",
  MISSING_DATE_MARKER: "missing_date_marker",
  MISSING_URL: "missing_url",
  MISSING_COMMIT_SHA: "missing_commit_sha",
  MISSING_FILE_PATH: "missing_file_path",
  MISSING_ID: "missing_id",
  POSSIBLE_NEGATION_LOSS: "possible_negation_loss",
});

const WARNING_ORDER = [
  COMPRESSION_WARNING_CODES.MISSING_NUMERIC_MARKER,
  COMPRESSION_WARNING_CODES.MISSING_PERCENTAGE_MARKER,
  COMPRESSION_WARNING_CODES.MISSING_DATE_MARKER,
  COMPRESSION_WARNING_CODES.MISSING_URL,
  COMPRESSION_WARNING_CODES.MISSING_COMMIT_SHA,
  COMPRESSION_WARNING_CODES.MISSING_FILE_PATH,
  COMPRESSION_WARNING_CODES.MISSING_ID,
  COMPRESSION_WARNING_CODES.POSSIBLE_NEGATION_LOSS,
];

const DATE_PATTERN = /(?:\b\d{4}[-/]\d{1,2}[-/]\d{1,2}\b|\b\d{4}年\d{1,2}月\d{1,2}日\b|\b\d{1,2}月\d{1,2}日\b)/gu;
const URL_PATTERN = /https?:\/\/[^\s<>"'`]+/giu;
const SHA_PATTERN = /\b[0-9a-f]{7,40}\b/giu;
const NUMBER_PATTERN = /[-+]?\d+(?:[.,]\d+)?/gu;
const PERCENTAGE_PATTERN = /[-+]?\d+(?:[.,]\d+)?\s*%/gu;
const FILE_PATH_PATTERN = /(?:[A-Za-z]:[\\/][^\s<>"'`]+|(?:\.{0,2}\/|\/)[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+|(?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+\.[A-Za-z0-9]+)/g;
const ID_PATTERN = /\b(?:[A-Za-z][A-Za-z0-9]*[_-]id|request[_-]?id|ID)\s*[:=]\s*["']?([A-Za-z0-9][A-Za-z0-9._-]*)/gu;
const NEGATION_PATTERN = /(?:含めない|含まない|禁止|しない|不可|できない|無効|除外|否定|ない|\b(?:must\s+not|do\s+not|does\s+not|not|never|without|prohibited|forbidden|cannot)\b)/giu;

function trimMarker(value) {
  return value.replace(/[。、．.,;；:：!?！？)）\]}]+$/u, "");
}

function normalizeForComparison(value) {
  return value.toLocaleLowerCase().replace(/\s+/gu, "");
}

function matchesAll(output, markers) {
  const normalizedOutput = normalizeForComparison(output);
  return markers.every((marker) => normalizedOutput.includes(normalizeForComparison(marker)));
}

function extractMatches(text, pattern) {
  return Array.from(text.matchAll(pattern), (match) => trimMarker(match[0]));
}

function extractUrls(text) {
  return Array.from(text.matchAll(URL_PATTERN), (match) => match[0].split(/[。、，,;；!?！？)）\]}]/u)[0]);
}

function extractNumbers(text, dates, percentages) {
  const dateRanges = Array.from(text.matchAll(DATE_PATTERN), (match) => [match.index, match.index + match[0].length]);
  const percentageRanges = Array.from(text.matchAll(PERCENTAGE_PATTERN), (match) => [match.index, match.index + match[0].length]);
  return Array.from(text.matchAll(NUMBER_PATTERN), (match) => {
    const start = match.index;
    const end = start + match[0].length;
    const inside = [...dateRanges, ...percentageRanges].some(([rangeStart, rangeEnd]) => start >= rangeStart && end <= rangeEnd);
    return inside ? null : trimMarker(match[0]);
  }).filter(Boolean).filter((marker) => !dates.includes(marker) && !percentages.includes(marker));
}

function extractIds(text) {
  return Array.from(text.matchAll(ID_PATTERN), (match) => ({
    key: match[0].slice(0, match[0].indexOf(match[1])).replace(/\s*[:=]\s*$/u, "").trim(),
    value: match[1],
  }));
}

export function inspectCompressionIntegrity(inputText, compressedText) {
  if (typeof inputText !== "string" || inputText.length === 0 || typeof compressedText !== "string") {
    return { warnings: [] };
  }

  const dates = extractMatches(inputText, DATE_PATTERN);
  const percentages = extractMatches(inputText, PERCENTAGE_PATTERN);
  const numbers = extractNumbers(inputText, dates, percentages);
  const urls = extractUrls(inputText);
  const commitShas = extractMatches(inputText, SHA_PATTERN).filter((value) => value.length >= 7);
  const filePaths = extractMatches(inputText, FILE_PATH_PATTERN).filter((value) => !/:\/\//u.test(value));
  const ids = extractIds(inputText);
  const negations = extractMatches(inputText, NEGATION_PATTERN);
  const warnings = [];
  const normalizedOutput = normalizeForComparison(compressedText);

  if (numbers.length > 0 && !matchesAll(compressedText, numbers)) warnings.push(COMPRESSION_WARNING_CODES.MISSING_NUMERIC_MARKER);
  if (percentages.length > 0 && !matchesAll(compressedText, percentages)) warnings.push(COMPRESSION_WARNING_CODES.MISSING_PERCENTAGE_MARKER);
  if (dates.length > 0 && !matchesAll(compressedText, dates)) warnings.push(COMPRESSION_WARNING_CODES.MISSING_DATE_MARKER);
  if (urls.length > 0 && !matchesAll(compressedText, urls)) warnings.push(COMPRESSION_WARNING_CODES.MISSING_URL);
  if (commitShas.length > 0 && !matchesAll(compressedText, commitShas)) warnings.push(COMPRESSION_WARNING_CODES.MISSING_COMMIT_SHA);
  if (filePaths.length > 0 && !matchesAll(compressedText, filePaths)) warnings.push(COMPRESSION_WARNING_CODES.MISSING_FILE_PATH);
  if (ids.some(({ key, value }) => !normalizedOutput.includes(normalizeForComparison(key)) || !normalizedOutput.includes(normalizeForComparison(value)))) {
    warnings.push(COMPRESSION_WARNING_CODES.MISSING_ID);
  }
  if (negations.length > 0 && extractMatches(compressedText, NEGATION_PATTERN).length < negations.length) {
    warnings.push(COMPRESSION_WARNING_CODES.POSSIBLE_NEGATION_LOSS);
  }

  return { warnings: WARNING_ORDER.filter((warning) => warnings.includes(warning)) };
}
