import { cronJobs } from 'convex/server';
import { api } from './_generated/api';

const crons = cronJobs();

crons.interval('run step', { seconds: 1 }, api.engine.step, {});

export default crons;
