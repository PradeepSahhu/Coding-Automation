import express from "express";
import fs from "fs";

const app = express();

app.use(express.json());

app.post("/jira-webhook", (req, res) => {
  console.log("Jira webhook received");

  const data = req.body;

  console.log(data.webhookEvent); // event type
  console.log(data);

  fs.writeFile("webhook-data.json", JSON.stringify(data, null, 2), (err) => {
    if (err) {
      console.error("Error writing file:", err);
      return res.sendStatus(500);
    }
    console.log("Webhook data saved to file");
    res.sendStatus(200);
  });

  //   res.sendStatus(200);
});

app.listen(3000, () => console.log("Running on port 3000"));
