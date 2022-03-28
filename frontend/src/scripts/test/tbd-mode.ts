import { Wordset } from "./wordset";
import * as TestInput from "./test-input";
import * as PageChangeEvent from "../observables/page-change-event";
import * as ConfigEvent from "../observables/config-event";
import * as TestStartedEvent from "../observables/test-started-event";
import { mean, median } from "../utils/misc";
import Config from "../config";
import Page from "../pages/page";
import * as ResultsShownEvent from "../observables/results-shown-event";
import * as WordTypedEvent from "../observables/word-typed-event";
import { debounce } from "../utils/debounce";
import UpdateData = MonkeyTypes.ResultsData;
import TbdModeData = MonkeyTypes.TbdModeData;
import TbdWordData = MonkeyTypes.TbdWordData;
import TbdMedianSpeeds = MonkeyTypes.TbdMedianSpeeds;

let currentGroupThreshold = 1;
let monkeyTypeWordset = new Wordset([]);
let currentGroupUnbeatenWordset = new Wordset([]);
let initialized = false;
const medianSpeeds: TbdMedianSpeeds = {};
type WordSorter = (word: string, word2: string) => number;

const groupThresholdStepSize = 5;
const $tbdModeInfo: JQuery<HTMLElement> = $("#tbdmodeInfo");
const $progressMeterTotal: JQuery<HTMLElement> = $(
  "#tbdmodeInfo .progressMeterTotal"
);
const $progressMeterGroup: JQuery<HTMLElement> = $(
  "#tbdmodeInfo .progressMeterGroup"
);
const $targetThreshold: JQuery<HTMLElement> = $("#tbdModeTargetThreshold");
const $groupThreshold: JQuery<HTMLElement> = $("#tbdModeGroupThreshold");
const $wordsDiv: JQuery<HTMLElement> = $("#tbdmodeInfo .wordsContainer .words");
const $wordInfo: JQuery<HTMLElement> = $("#tbdModeWordInfo");

function addToMissedCount(word: string, missedCount: number): void {
  // console.log("addToMissedCount(word: ");
  const data = getDataForWord(word);
  data.missedCount += missedCount;
  saveWordData(word, data);
}

function handleResultsShownEvent(results: UpdateData): void {
  //console.log("handleResultsShownEvent(results: ");
  toggleUI();
  if (!isTbdMode()) {
    return;
  }
  if (!results.difficultyFailed) {
    saveBurstsFromLatestResults();
    resetCurrentGroupThreshold();
    updateCurrentGroupUnbeatenWordset();
  }
  Object.keys(TestInput.missedWords).forEach((word: string) => {
    const missedCount = TestInput.missedWords[word];
    addToMissedCount(word, missedCount);
  });
  updateInfo();
}

function handleTestStartedEvent(): void {
  // console.log("handleTestStartedEvent(): ");
  toggleUI();
}

function resetCurrentWords(): void {
  //console.log("resetCurrentWords(): ");
  if (
    !confirm("Are you sure you want to reset the stats for the current words?")
  ) {
    return;
  }
  getMonkeyTypeWordset().words.forEach((word: string) => {
    resetStatsForWord(word);
  });
}

function resetStatsForWord(word: string): void {
  // console.log("resetStatsForWord(word: ");
  saveWordData(word, { speeds: [], missedCount: 0 });
  debouncedRecalculate();
}

function updateTargetSpeed(): void {
  //console.log("updateTargetSpeed(): ");
  const newTarget = parseInt(prompt("New target speed") || "");
  if (newTarget > 0) {
    configSet("targetSpeed", newTarget.toString());
    recalculate();
  }
}

function init(): void {
  // console.log("init(): ");
  if (initialized) {
    return;
  }
  ConfigEvent.subscribe(funboxChangeHandler);
  PageChangeEvent.subscribe(pageChangeHandler);
  ResultsShownEvent.subscribe(handleResultsShownEvent);
  TestStartedEvent.subscribe(handleTestStartedEvent);
  WordTypedEvent.subscribe(handleWordTyped);
  document
    .getElementById("tbdModeResetButton")
    ?.addEventListener("click", resetCurrentWords);
  document
    .getElementById("tbdModeSetTargetButton")
    ?.addEventListener("click", updateTargetSpeed);
  const tbdModeWordsContainer = document.getElementById(
    "tbdModeWordsContainer"
  );
  if (tbdModeWordsContainer) {
    tbdModeWordsContainer.addEventListener("mousemove", updateWordInfo);
    tbdModeWordsContainer.addEventListener("click", handleResetStatsClick);
    tbdModeWordsContainer.addEventListener("mouseleave", () =>
      $wordInfo.hide(0)
    );
  }
  $wordInfo.hide(0);
  initSorter();
  updateMedianSpeedCache();
  updateWordsetGroups(getMonkeyTypeWordset());
  initialized = true;
}

function handleWordTyped(
  word: string,
  isCorrect: boolean,
  burst: number,
  currentWordElement: JQuery<HTMLElement>
): void {
  console.log({ word, isCorrect, burst });
  if (!isCorrect) {
    return;
  }
  const wordElement = currentWordElement[0];
  if (burst > getTargetSpeed()) {
    animate(wordElement, "tbdBeaten");
  } else {
    animate(wordElement, "tbdLost");
  }
}

function initSorter(): void {
  //console.log("initSorter(): ");
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
      triggerUpdateUiWords();
    });
}
function handleResetStatsClick(event: MouseEvent): void {
  // console.log("handleResetStatsClick(event: ");
  const target = event.target;
  if (!(target instanceof HTMLDivElement)) {
    return;
  }
  if (!target.classList.contains("tbdWord")) {
    return;
  }
  // @ts-ignore
  const word = target.parentElement.dataset["word"] || "";
  if (word == "") {
    return;
  }
  if (confirm(`Delete all data for '${word}'?`)) {
    resetStatsForWord(word);
  }
}

function recalculate(): void {
  //console.log("recalculate(): ");
  updateMedianSpeedCache();
  updateWordsetGroups(getMonkeyTypeWordset());
  resetCurrentGroupThreshold();
  updateCurrentGroupUnbeatenWordset();
  updateInfo();
}

const debouncedRecalculate = debounce(recalculate, 10);

function updateWordInfo(event: MouseEvent): void {
  // console.log("updateWordInfo(event: ");
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }
  if (!target.classList.contains("tbdWord")) {
    return;
  }
  const word = target.parentElement?.dataset["word"];
  if (word == undefined) {
    return;
  }
  const wordData = getDataForWord(word);
  let wordInfoHtml = `
      <h3>"${word}"</h3>
      <div class="heading">Counts</div>
      <div class="statContainer">
        <span class="label">Correct: </span>
        <span class="stat good">${wordData.speeds.length}</span.>
      </div>
      <div class="statContainer">
        <span class="label">Missed: </span>
        <span class="stat bad">${getMistypedCountForWord(word)}</span>
      </div>`;
  if (wordData.speeds.length) {
    wordInfoHtml += `
          <div class="heading">Speeds</div>
      <div class="statContainer">
        <span class="label">Worst: </span>
        <span class="stat bad">${getSlowestSpeedForWord(word)}</span>
      </div>
      <div class="statContainer">
        <span class="label">Mean: </span>
        <span class="stat">${getMeanSpeedForWord(word)}</span>
      </div>
      <div class="statContainer">
        <span class="label">Median: </span>
        <span class="stat">${getMedianSpeedForWord(word)}</span>
      </div>
      <div class="statContainer">
        <span class="label">Best: </span>
        <span class="stat good">${getFastestSpeedForWord(word)}</span>
      </div>`;
  }
  wordInfoHtml += `<div class="helpText">click to reset data for '${word}'</div>`;
  $wordInfo.html(wordInfoHtml);
  getWordElement(word).append($wordInfo[0]);
  $wordInfo.show(200);
}

export function getWord(
  retrievedWordset: Wordset,
  originalWord: string
): string {
  //console.log("getWord(retrievedWordset: ");
  handleWordsetForNextWord(retrievedWordset);
  const tbdModeWordset = getCurrentGroupUnbeatenWordset();
  if (tbdModeWordset.length == 0) {
    return originalWord;
  }
  const random = Math.random() * 100;
  if (random < 50) {
    return getCurrentWordsetGroup().randomWord();
  } else {
    return tbdModeWordset.randomWord();
  }
}

function handleWordsetForNextWord(retrievedWordset: Wordset): void {
  // console.log("handleWordsetForNextWord(retrievedWordset: ");
  if (
    retrievedWordset.length != getMonkeyTypeWordset().length &&
    retrievedWordset.words.join("$") !== getMonkeyTypeWordset().words.join("$")
  ) {
    handleWordsetChanged(retrievedWordset);
  }
}

let tbdModeWordsetGroups: Array<Wordset> = [];

function getWordsetGroups(): Array<Wordset> {
  return tbdModeWordsetGroups;
}

function updateWordsetGroups(newWordset: Wordset): void {
  tbdModeWordsetGroups = [];
  const notPastTarget = newWordset.words.filter(
    (word) => !hasWordBeenBeaten(word, getTargetSpeed())
  );
  const uniqueWords = new Set(notPastTarget);
  const randomlySorted = Array.from(uniqueWords).sort(randomSorter);

  // This is an effort to ensure there are no tiny group sizes, like if there are 200
  // words and a group size of 18. Creating groups of size 18 would mean getting 11 groups
  // of 18 and 1 group of 2. This method ends up creating 8 groups of 17 (136) + 4 groups of
  // 16 (64). I'm sure there is a better way to calculate it but this seems to work and I'm
  // lazy when it comes to math.
  const desiredGroupSize = getGroupSize();
  const totalUniqueWords = uniqueWords.size;
  const actualGroupCount = Math.ceil(totalUniqueWords / desiredGroupSize);
  const maxGroupSize = Math.ceil(totalUniqueWords / actualGroupCount);
  const reducedGroupSize = maxGroupSize - 1;
  const sizes = [];
  let remainingWords = totalUniqueWords;
  for (let i = 0; i < actualGroupCount; i++) {
    if (remainingWords % maxGroupSize == 0) {
      sizes.push(maxGroupSize);
      remainingWords -= maxGroupSize;
    } else {
      sizes.push(reducedGroupSize);
      remainingWords -= reducedGroupSize;
    }
  }
  let start = 0;
  sizes.forEach((size) => {
    const words = randomlySorted.slice(start, start + size);
    tbdModeWordsetGroups.push(new Wordset(words));
    start = start + size;
  });

  console.log({ tbdModeWordsetGroups });
  currentWordsetGroup = tbdModeWordsetGroups[0];
}

function handleWordsetChanged(newWordset: Wordset): void {
  updateMonkeyTypeWordset(newWordset);
  recalculate();
}

function updateMonkeyTypeWordset(wordset: Wordset): void {
  // console.log("updateCurrentWordset(wordset: ");
  monkeyTypeWordset = wordset;
}

function getMonkeyTypeWordset(): Wordset {
  //console.log("getCurrentWordset(): ");
  return monkeyTypeWordset;
}

let currentWordsetGroup: Wordset;

function getCurrentWordsetGroup(): Wordset {
  return currentWordsetGroup || getMonkeyTypeWordset();
}

function updateCurrentWordsetGroup(): void {
  if (isWordsetComplete(getCurrentWordsetGroup())) {
    resetCurrentGroupThreshold();
    currentWordsetGroup = getNextIncompleteWordsetGroup();
    console.log({ currentWordsetGroup });
  }
}

function isWordsetComplete(wordset: Wordset): boolean {
  return wordset.words.every((word) =>
    hasWordBeenBeaten(word, getTargetSpeed())
  );
}

function getNextIncompleteWordsetGroup(): Wordset {
  const groups = getWordsetGroups();
  const firstIncomplete = groups.find((wordset) => {
    return !isWordsetComplete(wordset);
  });

  if (firstIncomplete != undefined) {
    return firstIncomplete;
  }

  return getMonkeyTypeWordset();
}

function updateCurrentGroupUnbeatenWordset(): void {
  updateCurrentWordsetGroup();
  const currentWordsetGroup = getCurrentWordsetGroup();
  let nextWordset = getUnbeatenWordset(
    currentWordsetGroup,
    getCurrentGroupThreshold()
  );
  while (nextWordset.length < 1) {
    bumpCurrentGroupThreshold();
    nextWordset = getUnbeatenWordset(
      currentWordsetGroup,
      getCurrentGroupThreshold()
    );
  }
  currentGroupUnbeatenWordset = nextWordset;
}

function getCurrentGroupUnbeatenWordset(): Wordset {
  //console.log("getModifiedWordset(): ");
  return currentGroupUnbeatenWordset;
}

function getUnbeatenWords(wordset: Wordset, atThreshold?: number): Set<string> {
  // console.log("getUnbeatenWordset(): ");
  const unbeatenWords = new Set(wordset.words);
  if (unbeatenWords.size > 0) {
    unbeatenWords.forEach((word) => {
      if (hasWordBeenBeaten(word, atThreshold)) {
        unbeatenWords.delete(word);
      }
    });
  }

  return unbeatenWords;
}

function funboxChangeHandler(
  key: string,
  funbox?: MonkeyTypes.ConfigValues
): void {
  //console.log("funboxChangeHandler(key: ");
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
  // console.log("pageChangeHandler(_previousPage: ");
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
  //console.log("getTbdModeData(): ");
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
  // console.log("updateTbdModeData(data: ");
  tbdModeData = data;
  localStorageUpdater(data);
}

function getDataForWord(word: string): TbdWordData {
  //console.log("getDataForWord(word: ");
  const data = getTbdModeData();
  if (!data.words[word]) {
    return { speeds: [], missedCount: 0 };
  }
  return data.words[word];
}

function getSpeedsForWord(word: string): Array<number> {
  // console.log("getSpeedsForWord(word: ");
  return getDataForWord(word).speeds || [];
}

function getSlowestSpeedForWord(word: string): number {
  //console.log("getSlowestSpeedForWord(word: ");
  const speeds = getSpeedsForWord(word);
  if (speeds.length == 0) {
    return 0;
  }

  return Math.min(...speeds);
}

function getFastestSpeedForWord(word: string): number {
  // console.log("getFastestSpeedForWord(word: ");
  const speeds = getSpeedsForWord(word);
  if (speeds.length == 0) {
    return 0;
  }

  return Math.max(...speeds);
}

function getMistypedCountForWord(word: string): number {
  //console.log("getMistypedCountForWord(word: ");
  return getDataForWord(word).missedCount;
}

function getMedianSpeedForWord(word: string): number {
  // console.log("getMedianSpeedForWord(word: ");
  return medianSpeeds[word] || 0;
}

function calculateMedianSpeedForWord(word: string): number {
  const wordSpeeds = getSpeedsForWord(word);
  if (wordSpeeds.length < 1) {
    return 0;
  }
  return median(wordSpeeds);
}

function getMeanSpeedForWord(word: string): number {
  //console.log("getMeanSpeedForWord(word: ");
  const speeds = getSpeedsForWord(word);
  if (speeds.length == 0) {
    return 0;
  }
  return Math.round(mean(speeds));
}

const localStorageUpdater = debounce((data: TbdWordData) => {
  // console.log("debounced localStorageUpdater called");
  localStorage.setItem("tbdModeData", JSON.stringify(data));
}, 1000);

function saveWordData(word: string, wordData: TbdWordData): void {
  //console.log("saveWordData(word: ");
  const data = getTbdModeData();
  data.words[word] = wordData;
  updateTbdModeData(data);
  medianSpeeds[word] = calculateMedianSpeedForWord(word);
}

export function addBurst(word: string, speed: number): void {
  // console.log("addBurst");
  const wordData = getDataForWord(word);
  wordData.speeds.push(speed);
  saveWordData(word, wordData);
}

export function getUnbeatenWordset(
  sourceWordset: Wordset,
  atThreshold?: number
): Wordset {
  //console.log("getNextWordset");
  if (sourceWordset.length == 0) {
    return sourceWordset;
  }
  const unbeatenWords = getUnbeatenWords(sourceWordset, atThreshold);
  return new Wordset(Array.from(unbeatenWords));
}

function hasWordBeenBeaten(word: string, atThreshold?: number): boolean {
  // console.log("hasWordBeenBeaten(word: ");
  if (!atThreshold) {
    atThreshold = getCurrentGroupThreshold();
  }
  return getMedianSpeedForWord(word) > atThreshold;
}

function bumpCurrentGroupThreshold(): void {
  //console.log("bumpThreshold(): ");
  const newThreshold = currentGroupThreshold + groupThresholdStepSize;
  setCurrentGroupThreshold(newThreshold);
}

function isTbdMode(): boolean {
  // console.log("isTbdMode(): ");
  return Config.funbox == "tbdmode";
}

function toggleUI(): void {
  //console.log("toggleUI(): ");
  if (isTbdMode()) {
    $tbdModeInfo.removeClass("hidden");
  } else {
    $tbdModeInfo.addClass("hidden");
  }
}

function saveBurstsFromLatestResults(): void {
  // console.log("saveBurstsFromLatestResults(): ");
  const resultWords = TestInput.input.history;
  const resultBursts = TestInput.burstHistory;

  for (let i = 0; i < resultWords.length; i++) {
    const word = resultWords[i];
    const burst = resultBursts[i];
    addBurst(word, burst);
  }
}

function updateTotalProgressMeter(): void {
  //console.log("updateProgressMeter(): ");
  const targetSpeed = getTargetSpeed();
  const allWords = getMonkeyTypeWordset();
  const count = allWords.length;
  const beatenAtTargetCount = allWords.words.filter((word: string) => {
    return hasWordBeenBeaten(word, targetSpeed);
  }).length;
  const percent = (beatenAtTargetCount / count) * 100 || 0;
  $progressMeterTotal.css("width", `${percent}%`);
  $progressMeterTotal.attr(
    "title",
    `${beatenAtTargetCount} words of ${count} total have been typed faster than the target of ${targetSpeed}`
  );
}

function updateGroupProgressMeter(): void {
  const targetSpeed = getTargetSpeed();
  const group = getCurrentWordsetGroup();
  const beatenAtTargetCount = group.words.filter((word: string) => {
    return hasWordBeenBeaten(word, targetSpeed);
  }).length;
  const percent = (beatenAtTargetCount / group.length) * 100 || 0;
  $progressMeterGroup.css("width", `${percent}%`);
  $progressMeterGroup.attr(
    "title",
    `${beatenAtTargetCount} words of ${group.length} in the current group have been typed faster than the target of ${targetSpeed}`
  );
}

export function updateInfo(): void {
  // console.log("updateInfo(): ");
  triggerUpdateUiWords();
  updateTotalProgressMeter();
  updateGroupProgressMeter();
  $targetThreshold.text(configGet("targetSpeed"));
  $groupThreshold.text(getCurrentGroupThreshold());
}

function updateMedianSpeedCache(): void {
  //console.log("updateAllMedianSpeeds(): ");
  const allTypedWords = getTbdModeData().words;
  Object.keys(allTypedWords).forEach((word: string) => {
    medianSpeeds[word] = calculateMedianSpeedForWord(word);
  });
}

const triggerUpdateUiWords = debounce((): void => {
  // console.log("triggerUpdateUiWords(): ");
  const start = Date.now();
  updateUiWords().then(() => {
    const duration = Date.now() - start;
    console.log(`UI Words Updated in ${duration}ms`);
  });
}, 25);

async function updateUiWords(): Promise<void> {
  //console.log("updateUiWords(): ");
  // avoid redraws for every change
  $wordsDiv.hide();
  const currentGroup = getCurrentWordsetGroup();
  [...document.querySelectorAll(".tbdWordContainer")]?.forEach(
    (wordElement) => {
      // @ts-ignore
      const word = wordElement.dataset["word"];
      if (!currentGroup.words.includes(word)) {
        // @ts-ignore
        wordElement.parentElement.removeChild(wordElement);
      }
    }
  );
  currentGroup.words.sort(getSorter()).forEach((word) => {
    const wordElement = getWordElement(word);
    $wordsDiv.append(wordElement);
    // Timeout ensures transitions work
    setTimeout(() => {
      wordElement.dataset["beatenAtTarget"] = hasWordBeenBeaten(
        word,
        getTargetSpeed()
      )
        ? "1"
        : "0";
      wordElement.dataset["beatenAtGroup"] = hasWordBeenBeaten(
        word,
        getCurrentGroupThreshold()
      )
        ? "1"
        : "0";
      wordElement.dataset["typed"] =
        getMedianSpeedForWord(word) == 0 ? "0" : "1";
      const percentComplete = getMedianSpeedForWord(word) / getTargetSpeed();
      const modifier = Math.min(percentComplete, 1);

      const baseScale = 0.75;
      const additional = (1 - baseScale) * modifier;
      // @ts-ignore
      wordElement.querySelector("div").style?.transform = `scale(${
        baseScale + additional
      })`;
    }, 0);
  });
  $wordsDiv.show();
}

function getWordElement(word: string): HTMLDivElement {
  //console.log("getWordElement(word: ");
  const query = `.tbdWordContainer[data-word="${word}"]`;
  const element = document.querySelector(query);
  if (!(element instanceof HTMLDivElement)) {
    const newDiv = document.createElement("div");
    newDiv.innerHTML = `<div class="tbdWord">${word}</div>`;
    newDiv.dataset["word"] = word;
    newDiv.classList.add("tbdWordContainer");
    return newDiv;
  }
  return element;
}

function setCurrentGroupThreshold(newThreshold: number): void {
  //console.log("setThreshold(newThreshold: ");
  if (currentGroupThreshold == newThreshold) {
    return;
  }
  currentGroupThreshold = newThreshold;
}

function getCurrentGroupThreshold(): number {
  //console.log("getCurrentThreshold(): ");
  return currentGroupThreshold;
}

export function resetCurrentGroupThreshold(): void {
  //console.log("resetThreshold(): ");
  setCurrentGroupThreshold(1);
}

/**
 * @param element
 * @param animation - both the keyframe animation and class with that animation. For simplicity
 * they must be the same.
 * @param delay - The number of MS to delay the animation
 */
const currentlyAnimating: Array<HTMLElement> = [];
function animate(element: HTMLElement, animation: string, delay = 0): void {
  //console.log("animate()");
  if (currentlyAnimating.includes(element)) {
    console.log("No stacked animations");
    return;
  }
  const callback = (event: AnimationEvent): void => {
    if (event.animationName !== animation) {
      return;
    }
    const index = currentlyAnimating.findIndex(
      (animatingElement) => animatingElement == element
    );
    if (index) {
      delete currentlyAnimating[index];
    }
    element.classList.remove(animation);
    element.removeEventListener("animationend", callback);
  };
  element.addEventListener("animationend", callback);
  setTimeout(() => {
    currentlyAnimating.push(element);
    element.classList.add(animation);
  }, delay);
}

function getSorter(): WordSorter {
  //console.log("getSorter(): ");
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

const randomSorter = (_a: any, _b: any): number => {
  return Math.random() < 0.5 ? -1 : 1;
};

const alphabeticalDescendingSorter = (word: string, word2: string): number => {
  //console.log("alphabeticalDescendingSorter ");
  return word.toLowerCase() < word2.toLowerCase() ? 1 : -1;
};

const alphabeticalAscendingSorter = (word: string, word2: string): number => {
  //console.log("alphabeticalAscendingSorter ");
  return word.toLowerCase() < word2.toLowerCase() ? -1 : 1;
};

const speedAscendingSorter = (word: string, word2: string): number => {
  //console.log("speedAscendingSorter ");
  const speed1 = getMedianSpeedForWord(word);
  const speed2 = getMedianSpeedForWord(word2);
  return speed1 - speed2;
};

const speedDescendingSorter = (word: string, word2: string): number => {
  //console.log("speedDescendingSorter ");
  const speed1 = getMedianSpeedForWord(word);
  const speed2 = getMedianSpeedForWord(word2);
  return speed2 - speed1;
};

const typedCountSorter = (word: string, word2: string): number => {
  //console.log("typedCountSorter ");
  const typed1 = getSpeedsForWord(word).length;
  const typed2 = getSpeedsForWord(word2).length;
  return typed2 - typed1;
};

const missedCountSorter = (word: string, word2: string): number => {
  // console.log("missedCountSorter ");
  return getMistypedCountForWord(word2) - getMistypedCountForWord(word);
};

function configGet(key: string): string {
  //console.log("configGet(key: ");
  const configData = getTbdModeData().config;
  return configData[key] || "";
}

// Strings ensure we can store in localStorage
function configSet(key: string, value: string): void {
  // console.log("configSet(key: ");
  const data = getTbdModeData();
  data.config[key] = value;
  updateTbdModeData(data);
}

function getTargetSpeed(): number {
  //console.log("getTargetSpeed(): ");
  return parseInt(configGet("targetSpeed") || "75");
}

function getGroupSize(): number {
  return parseInt(configGet("groupSize") || "30)");
}

init();
