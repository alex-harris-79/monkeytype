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
import UpdateData = MonkeyTypes.ResultsData;
import TbdDataType = MonkeyTypes.TbdDataType;
import TbdWordData = MonkeyTypes.TbdWordData;
import { debounce } from "../utils/debounce";

type WordSorter = (word: string, word2: string) => number;
type SomeJson = { [key: string]: any };

function isTbdMode(): boolean {
  // console.log("isTbdMode(): ");
  return Config.funbox == "tbdmode";
}

class TbdConfig {
  init(): void {
    WordTypedEvent.subscribe(this.handleWordTyped.bind(this));
    TbdEvents.addSubscriber(
      "setTargetButtonClicked",
      this.updateTargetSpeed.bind(this)
    );
    TbdEvents.addSubscriber("sorterSelectChanged", (data) => {
      this.set("sorter", data["value"]);
    });
    TbdEvents.dispatchEvent("configInitialized", {
      sorterName: this.getSorterName(),
      targetSpeed: this.getTargetSpeed(),
      groupSize: this.getGroupSize(),
    });
  }

  handleWordTyped(
    _word: string,
    isCorrect: boolean,
    burst: number,
    currentWordElement: JQuery<HTMLElement>
  ): void {
    if (!isCorrect) {
      return;
    }
    const wordElement = currentWordElement[0];
    const typedAboveTarget = burst > this.getTargetSpeed();
    if (typedAboveTarget) {
      TbdEvents.dispatchEvent("wordTypedCorrectly", { wordElement });
    } else {
      TbdEvents.dispatchEvent("wordMissed", { wordElement });
    }
  }

  get(key: string, defaultValue = ""): string {
    const configData = TbdData.getAll().config;
    return configData[key] || defaultValue;
  }

  set(key: string, value: string): void {
    const original = this.get(key);
    if (original == value) {
      return;
    }
    const data = TbdData.getAll();
    data.config[key] = value;
    TbdData.updateData(data);
    TbdEvents.dispatchEvent(`${key}-changed`, {
      original: original,
      newValue: value,
    });
  }

  updateTargetSpeed(): void {
    //console.log("updateTargetSpeed(): ");
    const newTarget = parseInt(prompt("New target speed") || "");
    if (newTarget > 0) {
      this.set("targetSpeed", newTarget.toString());
    }
  }

  getSorterName(): string {
    return this.get("sorter", "alphabetical-asc");
  }

  getTargetSpeed(): number {
    return parseInt(this.get("targetSpeed", "75"));
  }

  getGroupSize(): number {
    return parseInt(this.get("groupSize", "30"));
  }
}

class TbdSorting {
  static getSorter(name: string): WordSorter {
    switch (name) {
      case "alphabetical-asc":
        return TbdSorting.alphabeticalAscendingSorter;
      case "alphabetical-desc":
        return TbdSorting.alphabeticalDescendingSorter;
      case "speed-asc":
        return TbdSorting.speedAscendingSorter;
      case "speed-desc":
        return TbdSorting.speedDescendingSorter;
      case "typedCount":
        return TbdSorting.typedCountSorter;
      case "missedCount":
        return TbdSorting.missedCountSorter;
    }
    return TbdSorting.alphabeticalAscendingSorter;
  }

  static randomSorter(): number {
    return Math.random() < 0.5 ? -1 : 1;
  }

  static alphabeticalDescendingSorter(word: string, word2: string): number {
    //console.log("alphabeticalDescendingSorter ");
    return word.toLowerCase() < word2.toLowerCase() ? 1 : -1;
  }

  static alphabeticalAscendingSorter(word: string, word2: string): number {
    //console.log("alphabeticalAscendingSorter ");
    return word.toLowerCase() < word2.toLowerCase() ? -1 : 1;
  }

  static speedAscendingSorter(word: string, word2: string): number {
    //console.log("speedAscendingSorter ");
    const speed1 = TbdData.getMedianSpeedForWord(word);
    const speed2 = TbdData.getMedianSpeedForWord(word2);
    return speed1 - speed2;
  }

  static speedDescendingSorter(word: string, word2: string): number {
    //console.log("speedDescendingSorter ");
    const speed1 = TbdData.getMedianSpeedForWord(word);
    const speed2 = TbdData.getMedianSpeedForWord(word2);
    return speed2 - speed1;
  }

  static typedCountSorter(word: string, word2: string): number {
    //console.log("typedCountSorter ");
    const typed1 = TbdData.getSpeedsForWord(word).length;
    const typed2 = TbdData.getSpeedsForWord(word2).length;
    return typed2 - typed1;
  }

  static missedCountSorter(word: string, word2: string): number {
    // console.log("missedCountSorter ");
    return (
      TbdData.getMistypedCountForWord(word2) -
      TbdData.getMistypedCountForWord(word)
    );
  }
}

class TbdMode {
  private config: TbdConfig;
  private monkeyTypeWordset: Wordset;
  private groups: TbdGroups;

  constructor(config: TbdConfig) {
    this.config = config;
    this.monkeyTypeWordset = new Wordset([]);
    this.groups = new TbdGroups();
  }

  init(): void {
    this.config.init();
    ResultsShownEvent.subscribe(this.handleResultsShownEvent.bind(this));
    TbdEvents.addSubscriber(
      "resetButtonClicked",
      this.resetCurrentWords.bind(this)
    );
    TbdEvents.addSubscriber("wordClicked", this.resetWord.bind(this));
    TbdEvents.addSubscriber("targetSpeed-changed", () => {
      this.regenerateGroupsFromWordset(this.monkeyTypeWordset);
    });
  }

  getConfig(): TbdConfig {
    return this.config;
  }

  getWord(originalWordset: Wordset): string {
    this.handleWordsetForNextWord(originalWordset);
    const group = this.getCurrentGroup();
    const random = Math.random() * 100;
    if (random < 60 && group.getUnbeatenWordset().length > 0) {
      return group.getUnbeatenWordset().randomWord();
    } else {
      return group.getWordset().randomWord();
    }
  }

  getCurrentGroup(): TbdGroup {
    return (
      this.groups.getFirstIncompleteGroup(this.config.getTargetSpeed()) ||
      new TbdGroup(this.monkeyTypeWordset)
    );
  }

  handleWordsetForNextWord(wordset: Wordset): void {
    if (
      this.monkeyTypeWordset.length != wordset.length &&
      wordset.words.join("$") != this.monkeyTypeWordset.words.join("$")
    ) {
      this.handleNewWordset(wordset);
    }
  }

  handleNewWordset(wordset: Wordset): void {
    this.monkeyTypeWordset = wordset;
    this.regenerateGroupsFromWordset(wordset);
  }

  regenerateGroupsFromWordset(wordset: Wordset): void {
    const notAboveTargetSpeed = wordset.words.filter((word) => {
      return !TbdData.hasWordBeenTypedFasterThan(
        word,
        this.config.getTargetSpeed()
      );
    });
    const uniqueBelowTarget = new Set(notAboveTargetSpeed);
    this.groups.regenerateGroups(
      Array.from(uniqueBelowTarget),
      this.config.getGroupSize()
    );
    TbdEvents.dispatchEvent("nextGroup", {
      group: this.getCurrentGroup(),
      targetSpeed: this.config.getTargetSpeed(),
    });
  }

  handleResultsShownEvent(results: UpdateData): void {
    if (!results.difficultyFailed) {
      this.saveBurstsFromLatestResults();
    }
    this.saveMissesFromLatestResult();
    const group = this.getCurrentGroup();
    group.increaseThresholdUntilSomeWordsAreUnbeaten();

    TbdEvents.dispatchEvent("resultsProcessed", {
      currentGroup: group,
      monkeyTypeWordset: this.monkeyTypeWordset,
      targetSpeed: this.config.getTargetSpeed(),
    });
  }

  saveBurstsFromLatestResults(): void {
    // console.log("saveBurstsFromLatestResults(): ");
    const resultWords = TestInput.input.history;
    const resultBursts = TestInput.burstHistory;

    for (let i = 0; i < resultWords.length; i++) {
      const word = resultWords[i];
      const burst = resultBursts[i];
      TbdData.addBurst(word, burst);
    }
  }

  resetCurrentWords(): void {
    //console.log("resetCurrentWords(): ");
    if (
      !confirm(
        "Are you sure you want to reset the stats for the current words?"
      )
    ) {
      return;
    }
    TbdData.resetDataForWords(this.monkeyTypeWordset.words);
  }

  resetWord(data: SomeJson): void {
    const word = data["word"];
    if (!confirm(`Reset all data for ${word}?`)) {
      return;
    }
    TbdData.resetDataForWord(word);
  }

  saveMissesFromLatestResult(): void {
    Object.keys(TestInput.missedWords).forEach((word: string) => {
      const missedCount = TestInput.missedWords[word];
      TbdData.addToMissedCount(word, missedCount);
    });
  }
}

class TbdUI {
  private $groupThreshold: JQuery<HTMLElement> = $("#tbdModeGroupThreshold");
  private $wordInfo: JQuery<HTMLElement> = $("#tbdModeWordInfo");
  private $wordsDiv: JQuery<HTMLElement> = $(
    "#tbdmodeInfo .wordsContainer .words"
  );
  private $progressMeterTotal: JQuery<HTMLElement> = $(
    "#tbdmodeInfo .progressMeterTotal"
  );
  private $targetThreshold: JQuery<HTMLElement> = $("#tbdModeTargetThreshold");
  private $progressMeterGroup: JQuery<HTMLElement> = $(
    "#tbdmodeInfo .progressMeterGroup"
  );
  private $tbdModeInfo: JQuery<HTMLElement> = $("#tbdmodeInfo");

  private wordsContainer: HTMLDivElement;
  private resetWordsButton: HTMLDivElement;
  private setTargetButton: HTMLDivElement;
  private sorterSelect: HTMLSelectElement;
  private tbdMode: TbdMode;

  constructor(tbdMode: TbdMode) {
    this.tbdMode = tbdMode;

    const wordsContainer = document.getElementById("tbdModeWordsContainer");
    if (!(wordsContainer instanceof HTMLDivElement)) {
      throw new Error("Could not locate TBD words container");
    }
    this.wordsContainer = wordsContainer;

    const resetWordsButton = document.getElementById("tbdModeResetButton");
    if (!(resetWordsButton instanceof HTMLDivElement)) {
      throw new Error("Could not locate reset words button");
    }
    this.resetWordsButton = resetWordsButton;

    const setTargetButton = document.getElementById("tbdModeSetTargetButton");
    if (!(setTargetButton instanceof HTMLDivElement)) {
      throw new Error("Could not locate set target button");
    }
    this.setTargetButton = setTargetButton;

    const sorterSelect = document.getElementById("tbdModeSorterSelect");
    if (!(sorterSelect instanceof HTMLSelectElement)) {
      throw new Error("Could not locate sorter select");
    }
    this.sorterSelect = sorterSelect;

    this.$wordInfo.hide();
    this.$tbdModeInfo.hide();
  }

  init(): void {
    PageChangeEvent.subscribe(this.pageChangeHandler.bind(this));
    TestStartedEvent.subscribe(this.handleTestStartedEvent.bind(this));
    ConfigEvent.subscribe(this.handleFunboxChange.bind(this));
    this.wordsContainer.addEventListener(
      "mousemove",
      this.updateWordInfo.bind(this)
    );
    this.wordsContainer.addEventListener(
      "click",
      this.handleWordClicked.bind(this)
    );
    this.wordsContainer.addEventListener("mouseleave", () => {
      return this.$wordInfo.hide(0);
    });
    this.setTargetButton.addEventListener("click", () => {
      TbdEvents.dispatchEvent("setTargetButtonClicked");
    });
    TbdEvents.addSubscriber("wordTypedCorrectly", (data: SomeJson) => {
      this.animate(data["wordElement"], "tbdBeaten");
    });
    TbdEvents.addSubscriber("wordMissed", (data: SomeJson) => {
      this.animate(data["wordElement"], "tbdLost");
    });
    TbdEvents.addSubscriber("targetSpeed-changed", (data: SomeJson) => {
      this.$targetThreshold.text(data["newValue"]);
    });
    TbdEvents.addSubscriber("groupThresholdChanged", (data: SomeJson) => {
      this.$groupThreshold.text(data["threshold"]);
    });
    TbdEvents.addSubscriber("resultsProcessed", (data: SomeJson) => {
      const group: TbdGroup = data["currentGroup"];
      this.updateUiWords(group.getWordset().words);
    });
    TbdEvents.addSubscriber("resultsProcessed", (data: SomeJson) => {
      this.updateTotalProgressMeter(
        data["monkeyTypeWordset"],
        data["targetSpeed"]
      );
    });
    TbdEvents.addSubscriber("resultsProcessed", (data: SomeJson) => {
      this.updateGroupProgressMeter(data["currentGroup"], data["targetSpeed"]);
    });
    TbdEvents.addSubscriber("resultsProcessed", (data: SomeJson) => {
      this.$groupThreshold.text(data["currentGroup"].getThreshold());
    });
    this.sorterSelect.addEventListener("change", (event) => {
      TbdEvents.dispatchEvent("sorterSelectChanged", {
        // @ts-ignore
        value: event.target.value,
      });
      // @ts-ignore
      this.sortWords(TbdSorting.getSorter(event.target.value));
    });
    TbdEvents.addSubscriber(
      "sorter-changed",
      this.handleSorterChange.bind(this)
    );
    this.resetWordsButton.addEventListener("click", () => {
      TbdEvents.dispatchEvent("resetButtonClicked");
    });
    TbdEvents.addSubscriber("configInitialized", (config) => {
      this.$targetThreshold.text(config["targetSpeed"]);
    });
    TbdEvents.addSubscriber("nextGroup", (data) => {
      const group = data["group"];
      this.updateUiWords(group.getWordset().words);
    });
  }

  private currentlyAnimating: Array<HTMLElement> = [];

  /**
   * @param element
   * @param animation - both the keyframe animation and class with that animation. For simplicity
   * they must be the same.
   */
  animate(element: HTMLElement, animation: string): void {
    if (this.currentlyAnimating.includes(element)) {
      return;
    }
    const callback = (event: AnimationEvent): void => {
      if (event.animationName !== animation) {
        return;
      }
      const index = this.currentlyAnimating.findIndex(
        (animatingElement) => animatingElement == element
      );
      if (index) {
        delete this.currentlyAnimating[index];
      }
      element.classList.remove(animation);
      element.removeEventListener("animationend", callback);
    };
    element.addEventListener("animationend", callback);
    this.currentlyAnimating.push(element);
    element.classList.add(animation);
  }

  handleWordClicked(event: MouseEvent): void {
    const target = event.target;
    if (!(target instanceof HTMLDivElement)) {
      return;
    }
    if (!target.classList.contains("tbdWord")) {
      return;
    }
    const word = target.parentElement?.dataset["word"] || "";
    TbdEvents.dispatchEvent("wordClicked", { word: word });
  }

  handleSorterChange(data: SomeJson): void {
    const sorter = TbdSorting.getSorter(data["newValue"] || "");
    this.sortWords(sorter);
  }

  selectSorterOption(sorterName: string): void {
    [...document.querySelectorAll("#tbdModeSorterSelect option")].forEach(
      (option) => {
        if (!(option instanceof HTMLOptionElement)) {
          return;
        }
        if (option["value"] == sorterName) {
          option["selected"] = true;
        }
      }
    );
  }

  handleFunboxChange(
    key: string,
    _newValue?: MonkeyTypes.ConfigValues,
    _nosave?: boolean,
    _previousValue?: MonkeyTypes.ConfigValues,
    _fullConfig?: MonkeyTypes.Config
  ): void {
    if (key != "funbox") {
      return;
    }
    this.toggleUI();
  }

  handleTestStartedEvent(): void {
    this.toggleUI();
  }

  toggleUI(): void {
    if (isTbdMode()) {
      this.$tbdModeInfo.show();
    } else {
      this.$tbdModeInfo.hide();
    }
  }

  updateTotalProgressMeter(
    monkeyTypeWordset: Wordset,
    targetSpeed: number
  ): void {
    //console.log("updateProgressMeter(): ");
    const allWords = monkeyTypeWordset.words;
    const count = allWords.length;
    const beatenAtTargetCount = allWords.filter((word: string) => {
      return TbdData.hasWordBeenTypedFasterThan(word, targetSpeed);
    }).length;
    const percent = (beatenAtTargetCount / count) * 100 || 0;
    this.$progressMeterTotal.css("width", `${percent}%`);
    this.$progressMeterTotal.attr(
      "title",
      `${beatenAtTargetCount} words of ${count} total have been typed faster than the target of ${targetSpeed}`
    );
  }

  updateGroupProgressMeter(currentGroup: TbdGroup, targetSpeed: number): void {
    const groupWordset = currentGroup.getWordset();
    const beatenAtTargetCount = groupWordset.words.filter((word: string) => {
      return TbdData.hasWordBeenTypedFasterThan(word, targetSpeed);
    }).length;
    const percent = (beatenAtTargetCount / groupWordset.length) * 100 || 0;
    this.$progressMeterGroup.css("width", `${percent}%`);
    this.$progressMeterGroup.attr(
      "title",
      `${beatenAtTargetCount} words of ${groupWordset.length} in the current group have been typed faster than the target of ${targetSpeed}`
    );
  }

  pageChangeHandler(_previousPage: Page, nextPage: Page): void {
    // console.log("pageChangeHandler(_previousPage: ");
    if (Config.funbox !== "tbdmode") {
      return;
    }
    const pagesToShowInfo = ["test"];
    if (pagesToShowInfo.includes(nextPage.name)) {
      this.$tbdModeInfo.show();
    } else {
      this.$tbdModeInfo.hide();
    }
  }

  updateUiWords(wordsToShow: Array<string>): void {
    // Remove words we don't want to show
    this.$wordsDiv.hide();

    [...document.querySelectorAll(".tbdWordContainer")]?.forEach(
      (wordElement) => {
        // @ts-ignore
        const word = wordElement.dataset["word"];
        if (!wordsToShow.includes(word)) {
          // @ts-ignore
          wordElement.parentElement.removeChild(wordElement);
        }
      }
    );

    wordsToShow.forEach((word) => {
      this.updateWord(word);
    });
    this.$wordsDiv.show();
  }

  updateWord(word: string): void {
    const wordElement = this.getOrCreateWordElement(word);
    const targetSpeed = this.tbdMode.getConfig().getTargetSpeed();
    const groupSpeed = this.tbdMode.getCurrentGroup().getThreshold();
    // Timeout ensures transitions work
    setTimeout(() => {
      wordElement.dataset["beatenAtTarget"] =
        TbdData.hasWordBeenTypedFasterThan(word, targetSpeed) ? "1" : "0";
      wordElement.dataset["beatenAtGroup"] = TbdData.hasWordBeenTypedFasterThan(
        word,
        groupSpeed
      )
        ? "1"
        : "0";
      wordElement.dataset["typed"] =
        TbdData.getSpeedsForWord(word).length == 0 ? "0" : "1";
      const percentComplete = TbdData.getMedianSpeedForWord(word) / targetSpeed;
      const modifier = Math.min(percentComplete, 1);
      const baseScale = 0.75;
      const additional = (1 - baseScale) * modifier;
      // @ts-ignore
      wordElement.querySelector("div").style?.transform = `scale(${
        baseScale + additional
      })`;
    }, 0);
  }

  sortWords(sorter: WordSorter): void {
    const words = [...document.querySelectorAll(".tbdWordContainer")]?.map(
      (wordContainerElement) => {
        if (!(wordContainerElement instanceof HTMLDivElement)) {
          throw new Error("RUH ROH");
        }
        return wordContainerElement.dataset["word"] || "";
      }
    );
    const sorted = words.sort(sorter);
    sorted.forEach((word) => {
      const element = this.getOrCreateWordElement(word);
      this.$wordsDiv.append(element);
    });
  }

  getOrCreateWordElement(word: string): HTMLDivElement {
    const query = `.tbdWordContainer[data-word="${word}"]`;
    const element = document.querySelector(query);
    if (!(element instanceof HTMLDivElement)) {
      const newDiv = document.createElement("div");
      newDiv.innerHTML = `<div class="tbdWord">${word}</div>`;
      newDiv.dataset["word"] = word;
      newDiv.classList.add("tbdWordContainer");
      this.$wordsDiv.append(newDiv);
      return newDiv;
    }
    return element;
  }

  updateWordInfo(event: MouseEvent): void {
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
    const wordData = TbdData.getDataForWord(word);
    let wordInfoHtml = `
        <h3>"${word}"</h3>
        <div class="heading">Counts</div>
        <div class="statContainer">
          <span class="label">Correct: </span>
          <span class="stat good">${wordData.speeds.length}</span.>
        </div>
        <div class="statContainer">
          <span class="label">Missed: </span>
          <span class="stat bad">${TbdData.getMistypedCountForWord(word)}</span>
        </div>`;
    if (wordData.speeds.length) {
      wordInfoHtml += `
            <div class="heading">Speeds</div>
        <div class="statContainer">
          <span class="label">Worst: </span>
          <span class="stat bad">${TbdData.getSlowestSpeedForWord(word)}</span>
        </div>
        <div class="statContainer">
          <span class="label">Mean: </span>
          <span class="stat">${TbdData.getMeanSpeedForWord(word)}</span>
        </div>
        <div class="statContainer">
          <span class="label">Median: </span>
          <span class="stat">${TbdData.getMedianSpeedForWord(word)}</span>
        </div>
        <div class="statContainer">
          <span class="label">Best: </span>
          <span class="stat good">${TbdData.getFastestSpeedForWord(word)}</span>
        </div>`;
    }
    wordInfoHtml += `<div class="helpText">click to reset data for '${word}'</div>`;
    this.$wordInfo.html(wordInfoHtml);
    this.getOrCreateWordElement(word).append(this.$wordInfo[0]);
    this.$wordInfo.show(200);
  }
}

type TbdEventSubscriber = (data: SomeJson) => void;

class TbdEvents {
  private static subscribers: {
    [eventName: string]: Array<TbdEventSubscriber>;
  } = {};

  static dispatchEvent(name: string, data: SomeJson = {}): void {
    console.log({ name, data });
    const subscribers = this.subscribers[name] || [];
    subscribers.forEach((subscriber) => {
      subscriber(data);
    });
  }

  static addSubscriber(name: string, callback: TbdEventSubscriber): void {
    if (!Array.isArray(TbdEvents.subscribers[name])) {
      TbdEvents.subscribers[name] = [];
    }
    TbdEvents.subscribers[name].push(callback);
  }
}

class TbdData {
  private static localStorageKey = "tbdModeData";
  private static data: TbdDataType;

  private static updateLocalStorage: (data: TbdDataType) => void = debounce(
    (data: TbdDataType) => {
      localStorage.setItem(TbdData.localStorageKey, JSON.stringify(data));
    },
    1000
  );

  static getAll(): TbdDataType {
    if (TbdData.data) {
      return TbdData.data;
    }
    TbdData.data = TbdData.getFromLocalStorage();
    return TbdData.data;
  }

  static getFromLocalStorage(): TbdDataType {
    const defaultValue = { words: {}, config: {} };
    const storedData = localStorage.getItem(TbdData.localStorageKey);
    if (storedData == null) {
      return defaultValue;
    }

    // Try parsing local storage
    const parsed = JSON.parse(storedData);
    if (typeof parsed == "object") {
      return parsed;
    }

    return defaultValue;
  }

  static updateData(data: TbdDataType): void {
    TbdData.data = data;
    TbdData.updateLocalStorage(data);
  }

  static getDataForWord(word: string): TbdWordData {
    const data = TbdData.getAll();
    if (!data.words[word]) {
      return { speeds: [], missedCount: 0 };
    }
    return data.words[word];
  }

  static resetDataForWord(word: string): void {
    TbdData.saveWordData(word, { speeds: [], missedCount: 0 });
    TbdEvents.dispatchEvent("wordReset", { word: word });
  }

  static resetDataForWords(words: Array<string>): void {
    words.forEach((word) => TbdData.resetDataForWord(word));
  }

  static hasWordBeenTypedFasterThan(word: string, threshold: number): boolean {
    return TbdData.getMedianSpeedForWord(word) > threshold;
  }

  static getSpeedsForWord(word: string): Array<number> {
    // console.log("getSpeedsForWord(word: ");
    return TbdData.getDataForWord(word).speeds || [];
  }

  static getSlowestSpeedForWord(word: string): number {
    //console.log("getSlowestSpeedForWord(word: ");
    const speeds = TbdData.getSpeedsForWord(word);
    if (speeds.length == 0) {
      return 0;
    }

    return Math.min(...speeds);
  }

  static getFastestSpeedForWord(word: string): number {
    // console.log("getFastestSpeedForWord(word: ");
    const speeds = TbdData.getSpeedsForWord(word);
    if (speeds.length == 0) {
      return 0;
    }

    return Math.max(...speeds);
  }

  static getMistypedCountForWord(word: string): number {
    //console.log("getMistypedCountForWord(word: ");
    return TbdData.getDataForWord(word).missedCount;
  }

  static getMedianSpeedForWord(word: string): number {
    const wordSpeeds = TbdData.getSpeedsForWord(word);
    if (wordSpeeds.length < 1) {
      return 0;
    }
    return median(wordSpeeds);
  }

  static getMeanSpeedForWord(word: string): number {
    const speeds = TbdData.getSpeedsForWord(word);
    if (speeds.length == 0) {
      return 0;
    }
    return Math.round(mean(speeds));
  }

  static saveWordData(word: string, wordData: TbdWordData): void {
    const data = TbdData.getAll();
    data.words[word] = wordData;
    TbdData.updateData(data);
    TbdEvents.dispatchEvent("wordUpdated", { wordData });
  }

  static addBurst(word: string, speed: number): void {
    const wordData = TbdData.getDataForWord(word);
    wordData.speeds.push(speed);
    TbdData.saveWordData(word, wordData);
  }

  static addToMissedCount(word: string, missedCount: number): void {
    // console.log("addToMissedCount(word: ");
    const data = TbdData.getDataForWord(word);
    data.missedCount += missedCount;
    TbdData.saveWordData(word, data);
  }
}

class TbdGroups {
  private groups: Array<TbdGroup> = [];

  setGroups(groups: TbdGroup[]): void {
    this.groups = groups;
  }

  getGroups(): Array<TbdGroup> {
    return this.groups;
  }

  getFirstIncompleteGroup(targetSpeed: number): TbdGroup | null {
    return (
      this.groups.find((group) => {
        return group
          .getWordset()
          .words.some(
            (word) => !TbdData.hasWordBeenTypedFasterThan(word, targetSpeed)
          );
      }) || null
    );
  }

  regenerateGroups(words: Array<string>, desiredGroupSize: number): void {
    this.groups = [];
    if (words.length == 0) {
      return;
    }

    const randomlySorted = words.sort(TbdSorting.randomSorter);

    // This is an effort to ensure there are no tiny group sizes, like if there are 200
    // words and a group size of 18. Creating groups of size 18 would mean getting 11 groups
    // of 18 and 1 group of 2. This method ends up creating 8 groups of 17 (136) + 4 groups of
    // 16 (64). I'm sure there is a better way to calculate it but this seems to work and I'm
    // lazy when it comes to math.
    const total = words.length;
    const actualGroupCount = Math.ceil(total / desiredGroupSize);
    const maxGroupSize = Math.ceil(total / actualGroupCount);
    const reducedGroupSize = maxGroupSize - 1;
    const sizesToCreate = [];
    let remainingWords = total;
    for (let i = 0; i < actualGroupCount; i++) {
      if (remainingWords % maxGroupSize == 0) {
        sizesToCreate.push(maxGroupSize);
        remainingWords -= maxGroupSize;
      } else {
        sizesToCreate.push(reducedGroupSize);
        remainingWords -= reducedGroupSize;
      }
    }
    let start = 0;
    sizesToCreate.forEach((size) => {
      const words = randomlySorted.slice(start, start + size);
      const wordset = new Wordset(words);
      this.groups.push(new TbdGroup(wordset));
      start = start + size;
    });
  }
}

class TbdGroup {
  private wordset: Wordset;
  private threshold = 1;

  constructor(wordset: Wordset) {
    this.wordset = wordset;
  }

  getWordset(): Wordset {
    return this.wordset;
  }

  getThreshold(): number {
    return this.threshold;
  }

  bumpThreshold(): void {
    this.threshold += 1;
    TbdEvents.dispatchEvent("groupThresholdChanged", {
      threshold: this.threshold,
    });
  }

  getUnbeatenWordset(): Wordset {
    const unbeatenWords = this.wordset.words.filter((word) => {
      return !TbdData.hasWordBeenTypedFasterThan(word, this.getThreshold());
    });
    return new Wordset(unbeatenWords);
  }

  increaseThresholdUntilSomeWordsAreUnbeaten(): void {
    if (this.wordset.length == 0) {
      return;
    }
    while (this.getUnbeatenWordset().length == 0) {
      this.bumpThreshold();
    }
  }
}

const tbdConfig = new TbdConfig();
const tbdMode = new TbdMode(tbdConfig);
const ui = new TbdUI(tbdMode);
ui.init();
tbdMode.init();

export function getTbdMode(): TbdMode {
  return tbdMode;
}
