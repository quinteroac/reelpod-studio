import re

with open('src/App.test.tsx', 'r') as f:
    content = f.read()

# Replace any click to 'Visual Settings' right before querying for 'Image prompt'
# In many places we added: fireEvent.click(screen.getByRole('button', { name: 'Visual Settings' }));
# before image prompt changes.
# Let's just remove that line if it's right before 'Image prompt' change.

content = re.sub(
    r"fireEvent\.click\(screen\.getByRole\('button', \{ name: 'Visual Settings' \}\)\);\s*fireEvent\.change\(screen\.getByLabelText\('Image prompt'\)",
    "fireEvent.change(screen.getByLabelText('Image prompt')",
    content
)

# For the unified Generation request test:
# "const visualPromptSection = screen.getByRole('region', {\n      name: 'Visual prompt'\n    });"
# wait, 'Visual prompt' changed to 'Visualizer settings', and Image Prompt is now in 'Image prompt' section.
content = content.replace("'Visual prompt'", "'Visualizer settings'")

# But we also have a new section 'Image prompt' in Music tab.
# Let's fix sectionLabels array test
content = content.replace(
    "['Generation parameters', 'Generation actions']",
    "['Generation parameters', 'Image prompt', 'Generation actions']"
)

content = content.replace(
    "      'Generation parameters',\n      'Generation actions'\n    ]);",
    "      'Generation parameters',\n      'Image prompt',\n      'Generation actions'\n    ]);"
)


with open('src/App.test.tsx', 'w') as f:
    f.write(content)
