const { getScan } = require("./scan");

async function run() {
  const scan = await getScan({ force: true });
  console.log(JSON.stringify(scan, null, 2));
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
