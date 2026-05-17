#!/usr/bin/env ts-node

import { run } from '../src/index';

run(process.argv.slice(2)).catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
