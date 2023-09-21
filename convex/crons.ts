import { cronJobs } from 'convex/server';
import { api } from './_generated/api';
import { STEP_INTERVAL } from './constants';

const crons = cronJobs();

// crons.interval('run step', { seconds: STEP_INTERVAL / 1000 }, api.engine.step, {});

export default crons;
