import re

with open('src/App.test.tsx', 'r') as f:
    content = f.read()

# For Visuals tab
patterns_visuals = [
    r"getByLabelText\('Image prompt'\)",
    r"getByLabelText\('Active visualizer'\)",
    r"name: 'Visual prompt'",
    r"name: 'Post-processing effects'",
    r"getByTestId\('effect-row"
]

# For Queue tab
patterns_queue = [
    r"name: 'Generation queue'",
    r"getByText\('No generations yet.'\)"
]

blocks = content.split("it('")
for i in range(1, len(blocks)):
    block = blocks[i]
    needs_visuals = any(re.search(p, block) for p in patterns_visuals)
    needs_queue = any(re.search(p, block) for p in patterns_queue)
    
    if needs_visuals or needs_queue:
        # We find the render(<App />); and insert clicks
        if "render(<App />);" in block:
            injection = "render(<App />);\n"
            if needs_visuals:
                injection += "    fireEvent.click(screen.getByRole('button', { name: 'Visual Settings' }));\n"
            if needs_queue:
                injection += "    fireEvent.click(screen.getByRole('button', { name: 'Queue' }));\n"
            
            # Avoid duplicate injections
            if "fireEvent.click(screen.getByRole('button', { name: 'Visual Settings' }));" not in block and "fireEvent.click(screen.getByRole('button', { name: 'Queue' }));" not in block:
                blocks[i] = block.replace("render(<App />);\n", injection)

with open('src/App.test.tsx', 'w') as f:
    f.write("it('".join(blocks))

