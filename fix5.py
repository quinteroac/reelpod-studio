import re

with open('src/App.test.tsx', 'r') as f:
    content = f.read()

# Replace any leftover clicks to Visual Settings before Image prompt changes
content = re.sub(
    r"fireEvent\.click\(screen\.getByRole\('button', \{ name: 'Visual Settings' \}\)\);\s*fireEvent\.change\(screen\.getByLabelText\('Image prompt'\)",
    "fireEvent.change(screen.getByLabelText('Image prompt')",
    content
)

# Replace clicks to 'Visual Settings' before checking 'Use same prompt for image'
content = re.sub(
    r"fireEvent\.click\(screen\.getByRole\('button', \{ name: 'Visual Settings' \}\)\);\s*fireEvent\.click\(\s*screen\.getByRole\('checkbox', \{ name: 'Use same prompt for image' \}\)\s*\);",
    "fireEvent.click(\n      screen.getByRole('checkbox', { name: 'Use same prompt for image' })\n    );",
    content
)

# Replace clicks to 'Visual Settings' before checking expect
content = re.sub(
    r"fireEvent\.click\(screen\.getByRole\('button', \{ name: 'Visual Settings' \}\)\);\s*expect\(screen\.getByLabelText\('Image prompt'\)\)",
    "expect(screen.getByLabelText('Image prompt'))",
    content
)

content = re.sub(
    r"fireEvent\.click\(screen\.getByRole\('button', \{ name: 'Visual Settings' \}\)\);\s*expect\(screen\.queryByLabelText\('Image prompt'\)",
    "expect(screen.queryByLabelText('Image prompt')",
    content
)

content = content.replace(
    "const visualPromptSection = within(controlsColumn).getByRole('region', { name: 'Visual prompt' });\n    fireEvent.click(screen.getByRole('button', { name: 'Visual Settings' }));",
    "fireEvent.click(screen.getByRole('button', { name: 'Visual Settings' }));\n    const visualPromptSection = within(controlsColumn).getByRole('region', { name: 'Visual prompt' });"
)

# A specific test for the unified Image generation
content = content.replace(
    "fireEvent.click(screen.getByRole('button', { name: 'Visual Settings' }));\n    fireEvent.change(screen.getByLabelText('Image prompt')",
    "fireEvent.change(screen.getByLabelText('Image prompt')"
)

with open('src/App.test.tsx', 'w') as f:
    f.write(content)
