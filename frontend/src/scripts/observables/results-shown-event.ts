import UpdateData = MonkeyTypes.ResultsData;

type SubscribeFunction = (results: UpdateData) => void;

const subscribers: SubscribeFunction[] = [];

export function subscribe(fn: SubscribeFunction): void {
  subscribers.push(fn);
}

export function dispatch(results: UpdateData): void {
  subscribers.forEach((fn) => {
    try {
      fn(results);
    } catch (e) {
      console.error("Page change event subscriber threw an error");
      console.error(e);
    }
  });
}
