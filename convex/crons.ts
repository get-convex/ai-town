import { cronJobs } from 'convex/server';
import { api } from './_generated/api';
import { STEP_INTERVAL } from './constants';

const crons = cronJobs();

// crons.interval('run step', { seconds: STEP_INTERVAL / 1000 }, api.engine.step, {});

// crons.interval('run all agents', { seconds: 10 }, api.debug.randomBlockActions);

export default crons;
