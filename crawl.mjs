#!/usr/bin/env node
import { runCrawl } from './src/crawler/index.mjs';

const args = process.argv.slice(2);
const login = args.includes('--login');
const sectionArg = args.find((a, i) => args[i - 1] === '--section');
await runCrawl({ login, section: sectionArg });
