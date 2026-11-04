import type { ToolDef } from '../context.js';
import { createTools } from './create.js';
import { executeTools } from './execute.js';
import { exploreTools } from './explore.js';
import { observeTools } from './observe.js';
import { readTools } from './read.js';
import { utilityTools } from './utility.js';

export const ALL_TOOLS: ToolDef[] = [
  ...readTools,
  ...observeTools,
  ...executeTools,
  ...createTools,
  ...utilityTools,
  ...exploreTools,
];
