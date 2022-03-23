import { Wordset } from "../test/wordset";

type SubscribeFunction = (wordset: Wordset) => void;

const subscribers: SubscribeFunction[] = [];

export function subscribe(fn: SubscribeFunction): void {
  subscribers.push(fn);
}

export function dispatch(wordset: Wordset): void {
  subscribers.forEach((fn) => {
    try {
      fn(wordset);
    } catch (e) {
      console.error("Wordset event subscriber threw an error");
      console.error(e);
    }
  });
}
