import { Router } from 'express';
import { answerQuestion, streamAnswer } from '../query/pipeline.js';
import { recentTraces } from '../monitoring.js';
import { openSse } from '../utils/sse.js';

export const queryRouter = Router();

function readQuery(body) {
  const question = String(body?.question || '').trim();
  const repo = String(body?.repo || '').trim();

  if (!question) throw Object.assign(new Error('`question` is required'), { status: 400 });
  if (!repo) throw Object.assign(new Error('`repo` is required'), { status: 400 });

  return { question, repo };
}

queryRouter.post('/query', async (req, res, next) => {
  try {
    const { question, repo } = readQuery(req.body);
    res.json(await answerQuestion(question, repo));
  } catch (err) {
    next(err);
  }
});

queryRouter.post('/query/stream', async (req, res) => {
  let params;
  try {
    params = readQuery(req.body);
  } catch (err) {
    res.status(400).json({ detail: err.message });
    return;
  }

  const send = openSse(res);

  try {
    await streamAnswer(params.question, params.repo, send);
  } catch (err) {
    console.error('Query stream failed:', err);
    send({ type: 'error', content: err.message });
  } finally {
    res.end();
  }
});

queryRouter.get('/traces', (req, res) => {
  res.json({ traces: recentTraces(Number(req.query.limit) || 50) });
});
