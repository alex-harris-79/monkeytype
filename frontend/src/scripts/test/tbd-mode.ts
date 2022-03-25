import { Wordset } from "./wordset";
import * as TestInput from "./test-input";
import * as PageChangeEvent from "../observables/page-change-event";
import * as WordsetRetrievedEvent from "../observables/wordset-retrieved-event";
import * as ConfigEvent from "../observables/config-event";
import * as TestStartedEvent from "../observables/test-started-event";
import { median } from "../utils/misc";
import Config from "../config";
import Page from "../pages/page";
import * as ResultsShownEvent from "../observables/results-shown-event";
import { debounce } from "../utils/debounce";
import UpdateData = MonkeyTypes.ResultsData;
import TbdModeData = MonkeyTypes.TbdModeData;
import TbdWordData = MonkeyTypes.TbdWordData;

let threshold = 10;
let originalWordset = new Wordset([]);
let modifiedWordset = new Wordset([]);
let initialized = false;

const thresholdStepSize = 5;
const $tbdModeInfo: JQuery<HTMLElement> = $("#tbdmodeInfo");
const $progressMeter: JQuery<HTMLElement> = $("#tbdmodeInfo .progressMeter");
const $currentThreshold: JQuery<HTMLElement> = $(
  "#tbdmodeInfo .currentThreshold"
);
const $wordsRemaining: JQuery<HTMLElement> = $("#tbdmodeInfo .wordsRemaining");
const $wordsDiv: JQuery<HTMLElement> = $("#tbdmodeInfo .wordsContainer .words");

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
    .getElementById("tbdModeWordsContainer")
    ?.addEventListener("mouseover", (event) => {
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
      // @ts-ignore
      // eslint-disable-next-line @typescript-eslint/no-unused-vars,no-unused-vars
      const wordData = getDataForWord(word);
    });
  updateInfo();
  initialized = true;
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

function getBeatenWordset(): Wordset {
  const current = getCurrentWordset();
  const unbeaten = getUnbeatenWordset();
  const beaten = current.words.filter((word) => !unbeaten.words.includes(word));
  return new Wordset(beaten);
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
    return tbdModeData;
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
  const minimumNewWordsPerLevel = Math.min(originalUniqueWordset.length, 5);
  if (
    unbeatenWordset.length < minimumNewWordsPerLevel ||
    (unbeatenWordset.length == 1 && unbeatenWordset.randomWord() == "I")
  ) {
    // there seems to be an issue where sometimes "I" is never chosen as a word in custom with
    // random enabled
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

function updateProgressMeter(beatenWords: string[]): void {
  const percentComplete = Math.round(
    (beatenWords.length / getCurrentWordset().length) * 100
  );
  $progressMeter.css("width", `${percentComplete}%`);
}

export function updateInfo(): void {
  const unbeatenWordset = getUnbeatenWordset();
  const beaten = getBeatenWordset();
  updateUiWords();
  updateProgressMeter(beaten.words);
  $currentThreshold.text(threshold);
  $wordsRemaining.text(unbeatenWordset.length);
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
  currentWordset.words.sort().forEach((word) => {
    const wordElement = getWordElement(word);
    const wordData = getDataForWord(word);
    $wordsDiv.append(wordElement);
    setTimeout(() => {
      const beaten = hasWordBeenBeaten(word);
      if (beaten && wordElement.attr("data-beaten") == "0") {
        const randomTime = Math.round(Math.random() * 300);
        setTimeout(() => {
          animate(wordElement[0], "beaten", "beaten");
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
    return $(`<span class="tbdWord" data-word="${word}">${word}</span>`);
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
  animationName: string
): void {
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

init();
