const fs = require('fs');
let content = fs.readFileSync('src/App.test.tsx', 'utf8');

// Replace any leftover clicks to Visual Settings before Image prompt changes
content = content.replace(
    /fireEvent\.click\(screen\.getByRole\('button', { name: 'Visual Settings' }\)\);\s*fireEvent\.change\(screen\.getByLabelText\('Image prompt'\)/g,
    "fireEvent.change(screen.getByLabelText('Image prompt')"
);

// We also have clicks to 'Visual Settings' before checking 'Use same prompt for image' checkbox
content = content.replace(
    /fireEvent\.click\(screen\.getByRole\('button', { name: 'Visual Settings' }\)\);\s*fireEvent\.click\(\s*screen\.getByRole\('checkbox', { name: 'Use same prompt for image' }\)\s*\);/g,
    "fireEvent.click(\n      screen.getByRole('checkbox', { name: 'Use same prompt for image' })\n    );"
);

// Some tests might click 'Music Generation' explicitly. Let's make sure that's correct, but they shouldn't fail if it's there.
// One failing test at line 865 might be:
// fireEvent.click(screen.getByRole('button', { name: 'Visual Settings' }));
// expect(screen.getByLabelText('Image prompt')).toHaveValue(

content = content.replace(
    /fireEvent\.click\(screen\.getByRole\('button', { name: 'Visual Settings' }\)\);\s*expect\(screen\.getByLabelText\('Image prompt'\)\)/g,
    "expect(screen.getByLabelText('Image prompt'))"
);

// In US-001 preserving existing controls, we test presence of sections:
// const visualPromptSection = within(controlsColumn).getByRole('region', { name: 'Visual prompt' });
// It is now expected in the Music tab, so we shouldn't click "Visual Settings" before finding it.
content = content.replace(
    "fireEvent.click(screen.getByRole('button', { name: 'Visual Settings' }));\n    const visualPromptSection = within(controlsColumn).getByRole('region', { name: 'Visual prompt' });",
    "const visualPromptSection = within(controlsColumn).getByRole('region', { name: 'Visual prompt' });\n    fireEvent.click(screen.getByRole('button', { name: 'Visual Settings' }));"
);

// Also we have an "expect(screen.queryByLabelText('Image prompt')).not.toBeInTheDocument();" 
// which might be preceded by a click to Visual Settings in some test.
content = content.replace(
    /fireEvent\.click\(screen\.getByRole\('button', { name: 'Visual Settings' }\)\);\s*expect\(screen\.queryByLabelText\('Image prompt'\)/g,
    "expect(screen.queryByLabelText('Image prompt')"
);

fs.writeFileSync('src/App.test.tsx', content, 'utf8');
