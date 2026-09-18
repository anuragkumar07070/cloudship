import { config } from '../config.js';

const waiting = [];
let running = 0;

export function enqueue(task) {
  return new Promise((resolve, reject) => {
    waiting.push({ task, resolve, reject });
    pump();
  });
}

function pump() {
  while (running < config.concurrency && waiting.length > 0) {
    const { task, resolve, reject } = waiting.shift();
    running++;
    Promise.resolve()
      .then(task)
      .then(resolve, reject)
      .finally(() => { running--; pump(); });
  }
}