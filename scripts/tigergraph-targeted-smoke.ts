import { getVertex } from "../src/server/tigergraph";

const event = await getVertex("Event", "Q945090");
console.log(JSON.stringify(event));
