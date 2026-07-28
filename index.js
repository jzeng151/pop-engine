import express from 'express';
import checkInRouter from './routes/checkin.js';
import permitsRouter from './routes/permits.js';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use('/api/checkin', checkInRouter);
app.use('/api/permits', permitsRouter);

app.listen(PORT, () => {
  console.log(`PopEngine Backend running on port ${PORT}`);
});
