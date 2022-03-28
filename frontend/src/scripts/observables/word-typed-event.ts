type SubscribeFunction = (
  word: string,
  typedCorrectly: boolean,
  burst: number,
  currentTestWord: JQuery<HTMLElement>
) => void;

const subscribers: SubscribeFunction[] = [];

export function subscribe(fn: SubscribeFunction): void {
  subscribers.push(fn);
}

export function dispatch(
  word: string,
  typedCorrectly: boolean,
  burst: number,
  currentTestWord: JQuery<HTMLElement>
): void {
  subscribers.forEach((fn) => {
    try {
      fn(word, typedCorrectly, burst, currentTestWord);
    } catch (e) {
      console.error("Word Typed event subscriber threw an error");
      console.error(e);
    }
  });
}
