const canvas = await import("npm:canvas@3.2.0");
const createCanvas = canvas.createCanvas ?? canvas.default.createCanvas;
createCanvas(1, 1).getContext("2d").fillRect(0, 0, 1, 1);

const { generateChartForHttp } = await import("../app.ts");
const result = await generateChartForHttp({
  type: "pie",
  data: [
    { category: "A", value: 1 },
    { category: "B", value: 2 },
  ],
});

if (!result.success) {
  throw new Error(result.errorMessage ?? "SSR smoke test failed");
}

console.log(`SSR smoke test generated: ${result.resultObj}`);
