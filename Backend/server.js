import express from "express";

const app = express();

app.use(express.json());

app.post("/jira-webhook", (req, res) => {
  console.log("Jira webhook received");

  const data = req.body;

  console.log(data.webhookEvent); // event type
  console.log(data);

  res.sendStatus(200);
});

app.listen(3000, () => console.log("Running on port 3000"));
