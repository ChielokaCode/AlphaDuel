export default function handler(req: any, res: any) {
  console.log("Cron job triggered at", new Date().toISOString());
  res.status(200).send("Cron executed");
}
