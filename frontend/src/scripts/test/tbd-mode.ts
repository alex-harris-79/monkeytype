import { Wordset } from "./wordset";
import * as TestInput from "./test-input";
import * as PageChangeEvent from "../observables/page-change-event";
import * as WordsetRetrievedEvent from "../observables/wordset-retrieved-event";
import * as ConfigEvent from "../observables/config-event";
import * as TestStartedEvent from "../observables/test-started-event";
import { median, mean } from "../utils/misc";
import Config from "../config";
import Page from "../pages/page";
import * as ResultsShownEvent from "../observables/results-shown-event";
import { debounce } from "../utils/debounce";
import UpdateData = MonkeyTypes.ResultsData;
import TbdModeData = MonkeyTypes.TbdModeData;
import TbdWordData = MonkeyTypes.TbdWordData;

let threshold = 1;
let originalWordset = new Wordset([]);
let modifiedWordset = new Wordset([]);
let initialized = false;
type WordSorter = (word: string, word2: string) => number;

const thresholdStepSize = 5;
const $tbdModeInfo: JQuery<HTMLElement> = $("#tbdmodeInfo");
const $progressMeter: JQuery<HTMLElement> = $("#tbdmodeInfo .progressMeter");
const $currentThreshold: JQuery<HTMLElement> = $("#tbdModeCurrentThreshold");
const $targetThreshold: JQuery<HTMLElement> = $("#tbdModeTargetThreshold");
const $wordsDiv: JQuery<HTMLElement> = $("#tbdmodeInfo .wordsContainer .words");
const $wordInfo: JQuery<HTMLElement> = $("#tbdModeWordInfo");

function addToMissedCount(word: string, missedCount: number): void {
  const data = getDataForWord(word);
  data.missedCount += missedCount;
  saveWordData(word, data);
}

function handleResultsShownEvent(results: UpdateData): void {
  toggleUI();
  if (!isTbdMode()) {
    return;
  }
  if (!results.difficultyFailed) {
    saveBurstsFromLatestResults();
    updateModifiedWordset(getNextWordset());
  }
  Object.keys(TestInput.missedWords).forEach((word: string) => {
    const missedCount = TestInput.missedWords[word];
    addToMissedCount(word, missedCount);
  });
  updateInfo();
}

function handleTestStartedEvent(): void {
  toggleUI();
}

function resetCurrentWords(): void {
  if (
    !confirm("Are you sure you want to reset the stats for the current words?")
  ) {
    return;
  }
  getCurrentWordset().words.forEach((word: string) => {
    saveWordData(word, { speeds: [], missedCount: 0 });
  });
  updateInfo();
}

function updateTargetSpeed(): void {
  const newTarget = parseInt(prompt("New target speed") || "");
  if (newTarget > 0) {
    configSet("targetSpeed", newTarget.toString());
    updateInfo();
  } else {
    alert("Invalid speed. Try a number above 0 next time.");
  }
}

function init(): void {
  if (initialized) {
    return;
  }
  ConfigEvent.subscribe(funboxChangeHandler);
  PageChangeEvent.subscribe(pageChangeHandler);
  WordsetRetrievedEvent.subscribe(handleWordsetUpdate);
  ResultsShownEvent.subscribe(handleResultsShownEvent);
  TestStartedEvent.subscribe(handleTestStartedEvent);
  document
    .getElementById("tbdModeResetButton")
    ?.addEventListener("click", resetCurrentWords);
  document
    .getElementById("tbdModeSetTargetButton")
    ?.addEventListener("click", updateTargetSpeed);
  const tbdModeWordsContainer = document.getElementById(
    "tbdModeWordsContainer"
  );
  tbdModeWordsContainer?.addEventListener("mouseover", updateWordInfo);
  tbdModeWordsContainer?.addEventListener("mouseleave", () =>
    $wordInfo.hide(400)
  );
  $wordInfo.hide(0);
  updateInfo();
  initSorter();
  initialized = true;
}

function initSorter(): void {
  [...document.querySelectorAll("#tbdModeSorterSelect option")].forEach(
    (option) => {
      if (!(option instanceof HTMLOptionElement)) {
        return;
      }
      const sorter = configGet("sorter");
      if (option["value"] == sorter) {
        option["selected"] = true;
      }
    }
  );

  document
    .getElementById("tbdModeSorterSelect")
    ?.addEventListener("change", (event: Event) => {
      // @ts-ignore
      configSet("sorter", event?.target?.value);
      updateUiWords();
    });
}

function updateWordInfo(event: MouseEvent): void {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }
  if (!target.classList.contains("tbdWord")) {
    return;
  }
  const word = target.dataset["word"];
  if (word == undefined) {
    return;
  }
  const wordData = getDataForWord(word);
  if (wordData.speeds.length) {
    $wordInfo.html(
      `
      <dl>
        <dt>Word</dt>
        <dd>${word}</dd>
        <dt>Counts</dt>
        <dd>Successfully: ${wordData.speeds.length}</dd>
        <dd>Missed: ${getMistypedCountForWord(word)}</dd>

        <dt>Speeds</dt>
        <dd>Slowest: ${getSlowestSpeedForWord(word)}</dd>
        <dd>Mean: ${getMeanSpeedForWord(word)}</dd>
        <dd>Median: ${getMedianSpeedForWord(word)}</dd>
        <dd>Fastest: ${getFastestSpeedForWord(word)}</dd>
      </dl>`.trim()
    );
    getWordElement(word).append($wordInfo);
    $wordInfo.show(400);
  } else {
    $wordInfo.hide();
  }
}

export function getWord(): string {
  return getModifiedWordset().randomWord();
}

function handleWordsetUpdate(wordset: Wordset): void {
  if (wordset.words.join("$") !== originalWordset.words.join("$")) {
    handleWordsetChanged(wordset);
  }
}

function handleWordsetChanged(newWordset: Wordset): void {
  updateCurrentWordset(newWordset);
  updateModifiedWordset(getNextWordset());
  resetThreshold();
  getNextWordset();
  updateInfo();
}

function updateCurrentWordset(wordset: Wordset): void {
  console.log("updateCurrentWordset");
  originalWordset = wordset;
}

function getCurrentWordset(): Wordset {
  return originalWordset;
}

function updateModifiedWordset(wordset: Wordset): void {
  console.log("updateCurrentWordset");
  modifiedWordset = wordset;
}

function getModifiedWordset(): Wordset {
  return modifiedWordset;
}

function getUnbeatenWordset(): Wordset {
  let unbeatenWordset = new Wordset([]);
  const currentWordset = getCurrentWordset();
  if (currentWordset) {
    const unbeatenWords = currentWordset.words.filter((word) => {
      return !hasWordBeenBeaten(word);
    });
    unbeatenWordset = new Wordset(unbeatenWords);
  }
  return unbeatenWordset;
}

function funboxChangeHandler(
  key: string,
  funbox?: MonkeyTypes.ConfigValues
): void {
  if (key != "funbox") {
    return;
  }
  if (funbox == "tbdmode") {
    $tbdModeInfo.removeClass("hidden");
  } else {
    $tbdModeInfo.addClass("hidden");
  }
}

function pageChangeHandler(_previousPage: Page, nextPage: Page): void {
  if (Config.funbox !== "tbdmode") {
    return;
  }
  const pagesToShowInfo = ["test"];
  if (!pagesToShowInfo.includes(nextPage.name)) {
    $tbdModeInfo.addClass("hidden");
  } else {
    $tbdModeInfo.removeClass("hidden");
  }
}

let tbdModeData: TbdModeData;

function getTbdModeData(): TbdModeData {
  if (tbdModeData) {
    return <TbdModeData>tbdModeData;
  }
  tbdModeData = { words: {}, config: {} };

  // Try local storage
  const storedData = localStorage.getItem("tbdModeData");
  if (storedData == null) {
    return tbdModeData;
  }

  // Try parsing local storage
  const parsed = JSON.parse(storedData);
  if (typeof parsed == "object") {
    tbdModeData = parsed;
    return tbdModeData;
  }

  // localStorage data couldn't be used, so let's start over with the default
  updateTbdModeData(tbdModeData);
  return tbdModeData;
}

function updateTbdModeData(data: TbdModeData): void {
  tbdModeData = data;
  localStorageUpdater(data);
}

function getDataForWord(word: string): TbdWordData {
  const data = getTbdModeData();
  if (!data.words[word]) {
    return { speeds: [], missedCount: 0 };
  }
  return data.words[word];
}

function getSpeedsForWord(word: string): Array<number> {
  return getDataForWord(word).speeds;
}

function getSlowestSpeedForWord(word: string): number {
  const speeds = getSpeedsForWord(word);
  if (speeds.length == 0) {
    return 0;
  }

  return Math.min(...speeds);
}

function getFastestSpeedForWord(word: string): number {
  const speeds = getSpeedsForWord(word);
  if (speeds.length == 0) {
    return 0;
  }

  return Math.max(...speeds);
}

function getMistypedCountForWord(word: string): number {
  return getDataForWord(word).missedCount;
}

function getMedianSpeedForWord(word: string): number {
  const speeds = getSpeedsForWord(word);
  if (speeds.length == 0) {
    return 0;
  }
  return median(speeds);
}

function getMeanSpeedForWord(word: string): number {
  const speeds = getSpeedsForWord(word);
  if (speeds.length == 0) {
    return 0;
  }
  return Math.round(mean(speeds));
}

const localStorageUpdater = debounce((data: TbdWordData) => {
  localStorage.setItem("tbdModeData", JSON.stringify(data));
}, 1000);

function saveWordData(word: string, wordData: TbdWordData): void {
  const data = getTbdModeData();
  data.words[word] = wordData;
  updateTbdModeData(data);
}

export function addBurst(word: string, speed: number): void {
  console.log("addBurst");
  const wordData = getDataForWord(word);
  wordData.speeds.push(speed);
  saveWordData(word, wordData);
}

export function getNextWordset(): Wordset {
  console.log("getNextWordset");
  const unbeatenWordset = getUnbeatenWordset();
  const originalWordset = getCurrentWordset();
  const originalUniqueWordset = new Wordset([
    ...new Set(originalWordset.words),
  ]);
  const minimumNewWordsPerLevel = Math.min(originalUniqueWordset.length, 2);
  if (unbeatenWordset.length < minimumNewWordsPerLevel) {
    bumpThreshold();
    return getNextWordset();
  }

  // Add some random words just for fun
  const minWordsPerLevel = Math.min(3, originalUniqueWordset.length);
  if (unbeatenWordset.length >= minWordsPerLevel) {
    return unbeatenWordset;
  } else {
    const newWords: string[] = Array.from(unbeatenWordset.words);
    do {
      const newWord = originalUniqueWordset.randomWord();
      if (!newWords.includes(newWord)) {
        newWords.push(newWord);
      }
    } while (newWords.length < minWordsPerLevel);
    return new Wordset(newWords);
  }
}

function hasWordBeenBeaten(word: string): boolean {
  const speeds = getSpeedsForWord(word);
  if (speeds.length == 0) {
    return false;
  }
  return median(speeds) > threshold;
}

function bumpThreshold(): void {
  threshold += thresholdStepSize;
}

function isTbdMode(): boolean {
  return Config.funbox == "tbdmode";
}

function toggleUI(): void {
  if (isTbdMode()) {
    $tbdModeInfo.removeClass("hidden");
  } else {
    $tbdModeInfo.addClass("hidden");
  }
}

function saveBurstsFromLatestResults(): void {
  const resultWords = TestInput.input.history;
  const resultBursts = TestInput.burstHistory;

  for (let i = 0; i < resultWords.length; i++) {
    const word = resultWords[i];
    const burst = resultBursts[i];
    addBurst(word, burst);
  }
}

function updateProgressMeter(): void {
  const targetSpeed = getTargetSpeed();
  const allWords = getCurrentWordset();
  const count = allWords.length;
  const beatenAtTargetCount = allWords.words.filter(
    (word) => getMedianSpeedForWord(word) > targetSpeed
  ).length;
  const percent = (beatenAtTargetCount / count) * 100 || 0;
  $progressMeter.css("width", `${percent}%`);
}

export function updateInfo(): void {
  updateUiWords();
  updateProgressMeter();
  $currentThreshold.text(threshold);
  $targetThreshold.text(configGet("targetSpeed"));
}

function updateUiWords(): void {
  const currentWordset = getCurrentWordset();
  [...document.querySelectorAll(".tbdWord")].forEach((wordElement) => {
    // @ts-ignore
    const word = wordElement.dataset.word;
    if (!currentWordset.words.includes(word)) {
      // @ts-ignore
      wordElement.parentElement.removeChild(wordElement);
    }
  });
  currentWordset.words.sort(getSorter()).forEach((word) => {
    const wordElement = getWordElement(word);
    const wordData = getDataForWord(word);
    $wordsDiv.append(wordElement);
    setTimeout(() => {
      const beaten = hasWordBeenBeaten(word);
      const randomTime = Math.round(Math.random() * 300);
      if (beaten && wordElement.attr("data-beaten") == "0") {
        setTimeout(() => {
          animate(wordElement[0], "tbdBeaten");
        }, randomTime);
      }
      if (!beaten && wordElement.attr("data-beaten") == "1") {
        setTimeout(() => {
          animate(wordElement[0], "tbdLost");
        }, randomTime);
      }

      wordElement.attr("data-beaten", beaten ? "1" : "0");
      wordElement.attr("data-count", wordData.speeds.length);
      wordElement.attr("data-missed", wordData.missedCount);
    }, 0);
  });
}

function getWordElement(word: string): JQuery<HTMLElement> {
  const element = $(`.tbdWord[data-word="${word}"]`);
  if (element.length == 0) {
    return $(`<div class="tbdWord" data-word="${word}">${word}</div>`);
  }
  return element;
}

export function resetThreshold(): void {
  const currentWords = getCurrentWordset().words;
  if (currentWords.some((word: string) => getSpeedsForWord(word).length == 0)) {
    threshold = 1;
    return;
  }
  const medians = currentWords.map((word: string) =>
    median(getSpeedsForWord(word))
  );
  threshold = Math.min(...medians);
}

function animate(
  element: HTMLElement,
  animationClass: string,
  animationName?: string
): void {
  if (animationName == null) {
    animationName = animationClass;
  }
  const callback = (event: AnimationEvent): void => {
    if (event.animationName !== animationName) {
      return;
    }
    element.classList.remove(animationClass);
    element.removeEventListener("animationend", callback);
  };
  element.addEventListener("animationend", callback);
  element.classList.add(animationClass);
}

function getSorter(): WordSorter {
  switch (configGet("sorter")) {
    case "alphabetical-asc":
      return alphabeticalAscendingSorter;
    case "alphabetical-desc":
      return alphabeticalDescendingSorter;
    case "speed-asc":
      return speedAscendingSorter;
    case "speed-desc":
      return speedDescendingSorter;
    case "typedCount":
      return typedCountSorter;
    case "missedCount":
      return missedCountSorter;
  }
  return alphabeticalAscendingSorter;
}

const alphabeticalDescendingSorter = (word: string, word2: string): number => {
  return word < word2 ? 1 : -1;
};

const alphabeticalAscendingSorter = (word: string, word2: string): number => {
  return word < word2 ? -1 : 1;
};

const speedAscendingSorter = (word: string, word2: string): number => {
  const speed1 = getMedianSpeedForWord(word);
  const speed2 = getMedianSpeedForWord(word2);
  return speed1 - speed2;
};

const speedDescendingSorter = (word: string, word2: string): number => {
  const speed1 = getMedianSpeedForWord(word);
  const speed2 = getMedianSpeedForWord(word2);
  return speed2 - speed1;
};

const typedCountSorter = (word: string, word2: string): number => {
  const typed1 = getSpeedsForWord(word).length;
  const typed2 = getSpeedsForWord(word2).length;
  return typed2 - typed1;
};

const missedCountSorter = (word: string, word2: string): number => {
  return getMistypedCountForWord(word2) - getMistypedCountForWord(word);
};

function configGet(key: string): string {
  const configData = getTbdModeData().config;
  return configData[key] || "";
}

// Strings ensure we can store in localStorage
function configSet(key: string, value: string): void {
  const data = getTbdModeData();
  data.config[key] = value;
  updateTbdModeData(data);
}

function getTargetSpeed(): number {
  return parseInt(configGet("targetSpeed") || "75");
}

init();
