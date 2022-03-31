import { Wordset } from "./wordset";
import * as TestInput from "./test-input";
import * as PageChangeEvent from "../observables/page-change-event";
import * as ConfigEvent from "../observables/config-event";
import { mean, median } from "../utils/misc";
import Config from "../config";
import Page from "../pages/page";
import * as ResultsShownEvent from "../observables/results-shown-event";
import * as WordTypedEvent from "../observables/word-typed-event";
import * as ResetRequestedEvent from "../observables/reset-requested-event";
import UpdateData = MonkeyTypes.ResultsData;
import TbdDataType = MonkeyTypes.TbdDataType;
import TbdWordData = MonkeyTypes.TbdWordData;
import { debounce } from "../utils/debounce";

type WordSorter = (word: string, word2: string) => number;
type SomeJson = { [key: string]: any };

class TbdConfig {
  init(): void {
    TbdEvents.addSubscriber("sorterSelectChanged", (data) => {
      this.set("sorter", data["value"]);
    });

    TbdEvents.addSubscriber("configUpdateRequested", (data) => {
      switch (data["configSetting"]) {
        case "targetSpeed":
          this.processTargetSpeedUpdateRequest();
          break;
        case "groupSize":
          this.processGroupSizeUpdateRequest();
          break;
        case "animations":
          this.processAnimationToggleRequest();
          break;
        case "unbeatenWordPercentage":
          this.processUnbeatenWordPercentageRequest();
          break;
      }
    });
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

  bumpTargetSpeed(): void {
    const current = this.getTargetSpeed();
    this.set("targetSpeed", (current + 5).toString());
  }

  getSorterName(): string {
    return this.get("sorter", "alphabetical-asc");
  }

  getSorter(): WordSorter {
    return TbdSorting.getSorter(this.getSorterName());
  }

  getTargetSpeed(): number {
    return parseInt(this.get("targetSpeed", "75"));
  }

  getGroupSize(): number {
    return parseInt(this.get("groupSize", "30"));
  }

  getUnbeatenWordPercentage(): number {
    return parseInt(this.get("unbeatenWordPercentage", "60"));
  }

  processTargetSpeedUpdateRequest(): void {
    const newSpeed = parseInt(
      prompt("New target speed", this.getTargetSpeed().toString()) || ""
    );
    if (newSpeed > 0) {
      this.set("targetSpeed", newSpeed.toString());
    }
  }

  processAnimationToggleRequest(): void {
    const enabled = confirm("Confirm to enable, cancel to disable.");
    if (enabled) {
      this.set("animationsEnabled", "1");
    } else {
      this.set("animationsEnabled", "0");
    }
  }

  areAnimationsEnabled(): boolean {
    return this.get("animationsEnabled", "1") == "1";
  }

  processGroupSizeUpdateRequest(): void {
    const newSize = parseInt(
      prompt("New group size", this.getGroupSize().toString()) || ""
    );
    if (newSize > 0) {
      this.set("groupSize", newSize.toString());
    }
  }

  processUnbeatenWordPercentageRequest(): void {
    const newPercentage = parseInt(
      prompt(
        `The odds (still random) that a test word will be one that hasn't been typed faster than the current group threshold. 
        
        Must be between 10-90`,
        this.getUnbeatenWordPercentage().toString()
      ) || ""
    );
    if (isNaN(newPercentage)) {
      return;
    }
    if (newPercentage < 10 || newPercentage > 90) {
      alert(`${newPercentage} isn't a valid choice.`);
      return;
    }
    this.set("unbeatenWordPercentage", newPercentage.toString());
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
    return word.toLowerCase() < word2.toLowerCase() ? 1 : -1;
  }

  static alphabeticalAscendingSorter(word: string, word2: string): number {
    return word.toLowerCase() < word2.toLowerCase() ? -1 : 1;
  }

  static speedAscendingSorter(word: string, word2: string): number {
    const speed1 = TbdData.getMedianSpeedForWord(word);
    const speed2 = TbdData.getMedianSpeedForWord(word2);
    return speed1 - speed2;
  }

  static speedDescendingSorter(word: string, word2: string): number {
    const speed1 = TbdData.getMedianSpeedForWord(word);
    const speed2 = TbdData.getMedianSpeedForWord(word2);
    return speed2 - speed1;
  }

  static typedCountSorter(word: string, word2: string): number {
    const typed1 = TbdData.getSpeedsForWord(word).length;
    const typed2 = TbdData.getSpeedsForWord(word2).length;
    return typed2 - typed1;
  }

  static missedCountSorter(word: string, word2: string): number {
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
  private currentGroup: TbdGroup;
  private previousWord = "";

  constructor(config: TbdConfig) {
    this.config = config;
    this.monkeyTypeWordset = new Wordset([]);
    this.currentGroup = new TbdGroup(this.monkeyTypeWordset);
    this.groups = new TbdGroups();
  }

  init(): void {
    WordTypedEvent.subscribe(this.handleWordTyped.bind(this));
    ResultsShownEvent.subscribe(this.handleResultsShownEvent.bind(this));
    TbdEvents.addSubscriber(
      "resetButtonClicked",
      this.resetCurrentWords.bind(this)
    );
    TbdEvents.addSubscriber("wordClicked", this.resetWord.bind(this));
    TbdEvents.addSubscriber("targetSpeed-changed", () => {
      this.regenerateGroupsFromWordset(this.monkeyTypeWordset);
    });
    TbdEvents.addSubscriber("groupSize-changed", () => {
      this.regenerateGroupsFromWordset(this.monkeyTypeWordset);
    });
    TbdEvents.addSubscriber("wordsReset", () => {
      this.regenerateGroupsFromWordset(this.monkeyTypeWordset);
    });
    TbdEvents.addSubscriber("nextGroup", (data) => {
      this.currentGroup = data["group"];
    });
    TbdEvents.addSubscriber("groupsRegenerated", () => {
      ResetRequestedEvent.dispatch();
    });

    TbdEvents.addSubscriber("actionButtonClicked", (data) => {
      switch (data["actionValue"]) {
        case "resetCurrentWords":
          this.handleResetCurrentWordsRequest();
          break;
        case "resetAllWords":
          this.handleResetAllWordsRequest();
          break;
        case "copyAllData":
          this.handleCopyDataRequest();
          break;
        case "importData":
          this.handleImportDataRequest();
          break;
      }
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
    const typedAboveTarget = burst > this.getConfig().getTargetSpeed();
    if (typedAboveTarget) {
      TbdEvents.dispatchEvent("wordTypedCorrectly", { wordElement });
    } else {
      TbdEvents.dispatchEvent("wordMissed", { wordElement });
    }
  }

  handleResetCurrentWordsRequest(): void {
    if (
      confirm(
        "Are you sure you want to reset data for the current wordset? This includes all" +
          " words in the language or custom word set you are using, not just the current group!"
      )
    ) {
      TbdData.resetDataForWords(this.monkeyTypeWordset.words);
    }
  }

  handleCopyDataRequest(): void {
    navigator.clipboard.writeText(JSON.stringify(TbdData.getAll())).then(
      () => {
        alert("JSON copied to your clipboard");
      },
      () => {
        alert("There was a problem copying the data to your clipboard");
      }
    );
  }

  handleImportDataRequest(): void {
    const exportJson =
      prompt("Enter the JSON you got from an export here") || "";
    if (exportJson == "") {
      return;
    }
    const parsed = JSON.parse(exportJson);
    if ("words" in parsed && "config" in parsed) {
      TbdData.updateData(parsed, true);
      location.reload();
    } else {
      alert("There was something wrong with your JSON, sorry!");
    }
  }

  getConfig(): TbdConfig {
    return this.config;
  }

  getWord(originalWordset: Wordset): string {
    this.handleWordsetForNextWord(originalWordset);
    const group = this.getCurrentGroup();
    const random = Math.random() * 100;
    const unbeatenWordset = group.getUnbeatenWordset();
    const isThereMoreThanOneWord = group.getWordset().length > 1;
    let nextWord: string;
    if (
      unbeatenWordset.length > 0 &&
      random <= this.getConfig().getUnbeatenWordPercentage()
    ) {
      nextWord = unbeatenWordset.randomWord();
    } else {
      nextWord = group.getWordset().randomWord();
    }

    if (this.previousWord == nextWord && isThereMoreThanOneWord) {
      return this.getWord(originalWordset);
    }

    this.previousWord = nextWord;
    return nextWord;
  }

  getCurrentGroup(): TbdGroup {
    return this.currentGroup;
  }

  getFirstIncompleteGroup(): TbdGroup | null {
    return this.groups.getFirstIncompleteGroup(this.config.getTargetSpeed());
  }

  recalculateCurrentGroup(): void {
    if (
      this.getCurrentGroup().getUnbeatenWordset().length > 0 &&
      this.getCurrentGroup().getThreshold() <= this.getConfig().getTargetSpeed()
    ) {
      const index = this.groups.getGroups().indexOf(this.getCurrentGroup());
      TbdEvents.dispatchEvent("nextGroup", {
        group: this.getCurrentGroup(),
        groupNumber: index + 1,
      });
      return;
    }
    let next: TbdGroup | null = this.getFirstIncompleteGroup();
    while (next == null) {
      this.getConfig().bumpTargetSpeed(); // side effects, regenerates all groups
      next = this.getFirstIncompleteGroup();
    }
    const index = this.groups.getGroups().indexOf(this.currentGroup);
    TbdEvents.dispatchEvent("nextGroup", {
      group: next,
      groupNumber: index + 1,
    });
  }

  getMonkeyTypeWordset(): Wordset {
    return this.monkeyTypeWordset;
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
    if (uniqueBelowTarget.size == 0) {
      this.getConfig().bumpTargetSpeed();
      // Bumping the target triggers a regeneration of groups and infinite loops are no fun
      return;
    }
    this.groups.regenerateGroups(
      Array.from(uniqueBelowTarget),
      this.config.getGroupSize()
    );
  }

  handleResultsShownEvent(results: UpdateData): void {
    if (!results.difficultyFailed) {
      this.saveBurstsFromLatestResults();
    }
    this.saveMissesFromLatestResult();
    this.recalculateCurrentGroup();
    this.getCurrentGroup().increaseThresholdUntilSomeWordsAreUnbeaten();

    TbdEvents.dispatchEvent("resultsProcessed", {
      currentGroup: this.getCurrentGroup(),
      monkeyTypeWordset: this.monkeyTypeWordset,
      targetSpeed: this.config.getTargetSpeed(),
    });
  }

  saveBurstsFromLatestResults(): void {
    const resultWords = TestInput.input.history;
    const resultBursts = TestInput.burstHistory;

    for (let i = 0; i < resultWords.length; i++) {
      const word = resultWords[i];
      const burst = resultBursts[i];
      TbdData.addBurst(word, burst);
    }
  }

  resetCurrentWords(): void {
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

  handleResetAllWordsRequest(): void {
    let confirmationWord = "delete";
    let slowestSpeed = 1000;
    const allData = TbdData.getAll();
    Object.keys(allData.words)
      .filter((word: string) => TbdData.getMedianSpeedForWord(word) > 0)
      .forEach((word: string) => {
        const median = TbdData.getMedianSpeedForWord(word);
        if (
          median > 0 &&
          median < slowestSpeed &&
          word.length >= confirmationWord.length
        ) {
          confirmationWord = word;
          slowestSpeed = median;
        }
      });
    const confirmationString = `${confirmationWord} ${confirmationWord} ${confirmationWord}`;
    const response = prompt(
      `This will delete ALL your word data. To confirm, type: ${confirmationString}`
    );
    if (response == null) {
      return;
    }
    if (response == confirmationString) {
      allData.words = {};
      TbdData.updateData(allData, true);
      alert(
        "Ok! Your data has been deleted and you're starting over from scratch."
      );
      // Lazy, I know
      location.reload();
    } else {
      alert(
        `Good effort, but you typed 
        
        '${response}' 
        
        instead of 
        
        '${confirmationString}' 
        
        No reset for you!`
      );
    }
  }
}

class TbdUI {
  private $groupThreshold: JQuery<HTMLElement> = $("#tbdModeGroupThreshold");
  private $tbdModeGroupCount: JQuery<HTMLElement> = $("#tbdModeGroupCount");
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
  private $tbdModeHelpButton: JQuery<HTMLElement> = $(".tbdModeHelpButton");
  private $tbdModeHelp: JQuery<HTMLElement> = $("#tbdHelp");
  private $tbdBeatenExample: JQuery<HTMLElement> = $(".tbdBeatenExample");
  private $tbdLostExample: JQuery<HTMLElement> = $(".tbdLostExample");

  private $tbdModeActionsSelect: JQuery<HTMLSelectElement> = $(
    "#tbdModeActionsSelect"
  );
  private $tbdModeActionsButton: JQuery<HTMLElement> = $(
    "#tbdModeActionButton"
  );

  private $tbdModeConfigSettingsSelect: JQuery<HTMLElement> = $(
    "#tbdModeConfigSettings"
  );
  private $tbdModeConfigSettingsUpdateButton: JQuery<HTMLElement> = $(
    "#tbdModeUpdateConfigSettingsUpdateButton"
  );

  private wordsContainer: HTMLDivElement;
  private $sorterSelect: JQuery<HTMLElement> = $("#tbdModeSorterSelect");
  private tbdMode: TbdMode;
  private currentlyAnimating: Array<HTMLElement> = [];
  private $tbdModeGroupNumber: JQuery<HTMLElement> = $(
    "#tbdModeCurrentGroupNumber"
  );

  constructor(tbdMode: TbdMode) {
    this.tbdMode = tbdMode;

    const wordsContainer = document.getElementById("tbdModeWordsContainer");
    if (!(wordsContainer instanceof HTMLDivElement)) {
      throw new Error("Could not locate TBD words container");
    }
    this.wordsContainer = wordsContainer;

    this.$wordInfo.hide();
    this.$tbdModeInfo.hide();
  }

  init(): void {
    this.$tbdModeInfo.show(300);
    PageChangeEvent.subscribe(this.pageChangeHandler.bind(this));
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
    TbdEvents.addSubscriber("wordTypedCorrectly", (data: SomeJson) => {
      this.animate(data["wordElement"], "tbdBeaten");
    });
    TbdEvents.addSubscriber("wordMissed", (data: SomeJson) => {
      this.animate(data["wordElement"], "tbdLost");
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
    this.$sorterSelect.on("change", (event) => {
      if (!(event.target instanceof HTMLSelectElement)) {
        return;
      }
      TbdEvents.dispatchEvent("sorterSelectChanged", {
        value: event.target.value,
      });
    });
    TbdEvents.addSubscriber(
      "sorter-changed",
      this.handleSorterChange.bind(this)
    );
    TbdEvents.addSubscriber("nextGroup", (data) => {
      const group = data["group"];
      this.updateUiWords(group.getWordset().words);
    });
    TbdEvents.addSubscriber("nextGroup", () => {
      this.updateGroupProgressMeter(
        this.tbdMode.getCurrentGroup(),
        this.tbdMode.getConfig().getTargetSpeed()
      );
      this.updateTotalProgressMeter(
        this.tbdMode.getMonkeyTypeWordset(),
        this.tbdMode.getConfig().getTargetSpeed()
      );
    });
    // Can't use targetSpeed-changed because of stupid recursive way of
    // auto bumping threshold to ensure there are always groups
    TbdEvents.addSubscriber("nextGroup", () => {
      this.$targetThreshold.text(
        this.tbdMode.getConfig().getTargetSpeed().toString()
      );
    });

    this.$tbdModeHelpButton.on("click", () => {
      this.$tbdModeHelp.toggle(250);
      this.$wordsDiv.toggle(250);
    });
    this.$tbdBeatenExample.on("click", (event) => {
      this.animate(event.target, "tbdBeaten");
    });
    this.$tbdLostExample.on("click", (event) => {
      this.animate(event.target, "tbdLost");
    });

    this.$targetThreshold.text(this.tbdMode.getConfig().getTargetSpeed());
    this.$groupThreshold.text(this.tbdMode.getCurrentGroup().getThreshold());

    this.$tbdModeConfigSettingsUpdateButton.on("click", () => {
      const selectValue = this.$tbdModeConfigSettingsSelect.val();
      if (selectValue == "") {
        alert("Select an option from the dropdown first");
      } else {
        TbdEvents.dispatchEvent("configUpdateRequested", {
          configSetting: selectValue,
        });
      }
    });

    this.$tbdModeActionsButton.on("click", () => {
      const selectValue = this.$tbdModeActionsSelect.val();
      if (selectValue == "") {
        alert("Select an option from the dropdown first");
      } else {
        TbdEvents.dispatchEvent("actionButtonClicked", {
          actionValue: selectValue,
        });
      }
    });

    TbdEvents.addSubscriber("wordSaved", (data) => {
      const word = data["word"] || "";
      if (word == "") {
        return;
      }
      const element = this.getWordElement(word);
      if (!element) {
        return;
      }
      this.updateWord(word);
    });

    TbdEvents.addSubscriber("groupsRegenerated", (data) => {
      this.$tbdModeGroupCount.text(data["groups"].length);
    });

    TbdEvents.addSubscriber("nextGroup", (data) => {
      this.$tbdModeGroupNumber.text(data["groupNumber"]);
      this.$groupThreshold.text(data["group"].getThreshold());
    });

    this.$sorterSelect
      .find(`option[value="${this.tbdMode.getConfig().getSorterName()}"]`)
      .attr("selected", "");
  }

  /**
   * @param element
   * @param animation - both the keyframe animation and class with that animation. For simplicity
   * they must be the same.
   */
  animate(element: HTMLElement, animation: string): void {
    if (!this.tbdMode.getConfig().areAnimationsEnabled()) {
      return;
    }
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
      if (index >= 0) {
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
    if (word == "") {
      return;
    }
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

  updateTotalProgressMeter(
    monkeyTypeWordset: Wordset,
    targetSpeed: number
  ): void {
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

    [...document.querySelectorAll(".words .tbdWordContainer")]?.forEach(
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

    this.sortWords(this.tbdMode.getConfig().getSorter());

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
      wordElement.dataset["missedMore"] =
        TbdData.getMistypedCountForWord(word) >
        TbdData.getSpeedsForWord(word).length
          ? "1"
          : "0";
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

  getWordElement(word: string): HTMLDivElement | null {
    const query = `.tbdWordContainer[data-word="${word}"]`;
    return document.querySelector(query);
  }
  getOrCreateWordElement(word: string): HTMLDivElement {
    const element = this.getWordElement(word);
    if (element) {
      return element;
    }
    const newDiv = document.createElement("div");
    newDiv.innerHTML = `<div class="tbdWord">${word}</div>`;
    newDiv.dataset["word"] = word;
    newDiv.classList.add("tbdWordContainer");
    this.$wordsDiv.append(newDiv);
    return newDiv;
  }

  updateWordInfo(event: MouseEvent): void {
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
    wordInfoHtml += `<div class="helpText">click to reset word data</div>`;
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

  static debouncedDispatch = debounce(TbdEvents.dispatchEvent, 50);

  static dispatchEvent(name: string, data: SomeJson = {}): void {
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

  private static debouncedUpdateLocalStorage = debounce(
    TbdData.updateLocalStorage,
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

  static updateData(data: TbdDataType, immediately = false): void {
    TbdData.data = data;
    if (immediately) {
      TbdData.updateLocalStorage(data);
    } else {
      TbdData.debouncedUpdateLocalStorage(data);
    }
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
    TbdEvents.dispatchEvent("wordsReset", { words: words });
  }

  static hasWordBeenTypedFasterThan(word: string, threshold: number): boolean {
    return TbdData.getMedianSpeedForWord(word) > threshold;
  }

  static getSpeedsForWord(word: string): Array<number> {
    return TbdData.getDataForWord(word).speeds || [];
  }

  static getSlowestSpeedForWord(word: string): number {
    const speeds = TbdData.getSpeedsForWord(word);
    if (speeds.length == 0) {
      return 0;
    }

    return Math.min(...speeds);
  }

  static getFastestSpeedForWord(word: string): number {
    const speeds = TbdData.getSpeedsForWord(word);
    if (speeds.length == 0) {
      return 0;
    }

    return Math.max(...speeds);
  }

  static getMistypedCountForWord(word: string): number {
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
    TbdEvents.dispatchEvent("wordSaved", { word: word, data: wordData });
  }

  static addBurst(word: string, speed: number): void {
    if (word == "") {
      return;
    }
    const wordData = TbdData.getDataForWord(word);
    wordData.speeds.push(speed);
    TbdData.saveWordData(word, wordData);
  }

  static addToMissedCount(word: string, missedCount: number): void {
    const data = TbdData.getDataForWord(word);
    data.missedCount += missedCount;
    TbdData.saveWordData(word, data);
  }

  private static updateLocalStorage(data: TbdDataType): void {
    localStorage.setItem(TbdData.localStorageKey, JSON.stringify(data));
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
    TbdEvents.dispatchEvent("groupsRegenerated", { groups: this.groups });
    TbdEvents.dispatchEvent("nextGroup", {
      group: this.getGroups()[0],
      groupNumber: 1,
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

ConfigEvent.subscribe(handleFunboxChange);

function isTbdMode(): boolean {
  return Config.funbox == "tbdmode";
}

function handleFunboxChange(
  key: string,
  _newValue?: MonkeyTypes.ConfigValues,
  _nosave?: boolean,
  _previousValue?: MonkeyTypes.ConfigValues,
  _fullConfig?: MonkeyTypes.Config
): void {
  if (key != "funbox") {
    return;
  }
  if (isTbdMode() && !getTbdMode()) {
    const tbdConfig = new TbdConfig();
    tbdConfig.init();

    tbdMode = new TbdMode(tbdConfig);
    tbdMode.init();

    const ui = new TbdUI(tbdMode);
    ui.init();
  } else if (!isTbdMode() && getTbdMode()) {
    // This was the easiest way I could think of to ensure there's nothing left over
    // after switching from TBD Mode to something else.
    location.reload();
  }
}

let tbdMode: TbdMode | undefined;
export function getTbdMode(): TbdMode | undefined {
  return tbdMode;
}
