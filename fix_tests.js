const fs = require('fs');

const path = 'src/App.test.tsx';
let content = fs.readFileSync(path, 'utf8');

// The lines we want to inject click for Visual Settings
const visualStrings = [
  "getByLabelText('Image prompt')",
  "getByLabelText('Active visualizer')",
  "getByRole('region', {\n      name: 'Visual prompt'",
  "getByRole('region', {\n        name: 'Visual prompt'",
  "getByRole('group', {\n      name: 'Post-processing effects'",
  "getByRole('checkbox'",
  "getByTestId('effect-row"
];

const blocks = content.split("it('");
for (let i = 1; i < blocks.length; i++) {
  if (visualStrings.some(s => blocks[i].includes(s))) {
    // Inject tab switch after render(<App />);
    if (!blocks[i].includes("fireEvent.click(screen.getByRole('button', { name: 'Visual Settings' }));")) {
      blocks[i] = blocks[i].replace(
        "render(<App />);", 
        "render(<App />);\n    fireEvent.click(screen.getByRole('button', { name: 'Visual Settings' }));"
      );
    }
  }
}

content = blocks.join("it('");

// Fix queue tests
const queueStrings = [
  "getByText('No generations yet')",
  "getByRole('region', { name: 'Generation queue' })"
];

const blocksQ = content.split("it('");
for (let i = 1; i < blocksQ.length; i++) {
  if (queueStrings.some(s => blocksQ[i].includes(s))) {
    if (!blocksQ[i].includes("fireEvent.click(screen.getByRole('button', { name: 'Queue' }));")) {
      blocksQ[i] = blocksQ[i].replace(
        "render(<App />);", 
        "render(<App />);\n    fireEvent.click(screen.getByRole('button', { name: 'Queue' }));"
      );
    }
  }
}
content = blocksQ.join("it('");

fs.writeFileSync(path, content, 'utf8');
