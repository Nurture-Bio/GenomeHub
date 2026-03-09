const { Project, SyntaxKind } = require('ts-morph');

const project = new Project();
// Add your component files here
project.addSourceFilesAtPaths("packages/client/src/**/*.tsx");

console.log("🔍 Scanning for Hybrid Architecture Flashes...\n");

project.getSourceFiles().forEach(sourceFile => {
  const fileName = sourceFile.getBaseName();

  // ------------------------------------------------------------------------
  // CLASS 1: State Machine Orphans
  // Looks for early returns inside event handlers (like onUp, onPointerUp)
  // that might skip committing state to parents.
  // ------------------------------------------------------------------------
  const arrowFunctions = sourceFile.getDescendantsOfKind(SyntaxKind.ArrowFunction);
  arrowFunctions.forEach(func => {
    const parent = func.getParent();
    if (parent && parent.getKind() === SyntaxKind.VariableDeclaration) {
      const name = parent.getName();
      if (name.startsWith('onUp') || name.startsWith('handleDragEnd') || name.startsWith('onPointer')) {
        const returns = func.getDescendantsOfKind(SyntaxKind.ReturnStatement);
        returns.forEach(ret => {
          // If there's an early return that doesn't return a value
          if (!ret.getExpression()) {
             console.log(`⚠️  [CLASS 1: Orphan Exit Path] in ${fileName} -> ${name}`);
             console.log(`   Line ${ret.getStartLineNumber()}: Early return detected. Ensure parent callbacks (onCommit) are fired before returning.\n`);
          }
        });
      }
    }
  });

  // ------------------------------------------------------------------------
  // CLASS 2: Double-Write Jank
  // Looks for imperative DOM writes (e.g., setProperty) immediately paired
  // with parent callback invocations (e.g., onDrag) in the same block.
  // ------------------------------------------------------------------------
  const blocks = sourceFile.getDescendantsOfKind(SyntaxKind.Block);
  blocks.forEach(block => {
    const statements = block.getStatements();
    let hasImperativeWrite = false;
    let parentCallback = null;

    statements.forEach(stmt => {
      const text = stmt.getText();
      // Check for imperative writes
      if (text.includes('.style.setProperty') || text.includes('syncTrack') || text.includes('syncHistogram')) {
        hasImperativeWrite = true;
      }
      // Check for parent prop callbacks commonly used in rapid handlers
      if (text.includes('onDrag(') || text.includes('onMove(')) {
        parentCallback = text.split('(')[0].trim();
      }
    });

    if (hasImperativeWrite && parentCallback) {
      console.log(`🐌 [CLASS 2: Render Thrashing] in ${fileName}`);
      console.log(`   Line ${block.getStartLineNumber()}: Imperative write mixed with ${parentCallback}().`);
      console.log(`   This triggers a React render and an imperative DOM update in the same frame.\n`);
    }
  });

  // ------------------------------------------------------------------------
  // CLASS 3: Compositor Snapping
  // Looks for inline style animations conditionally toggled to 'none'.
  // ------------------------------------------------------------------------
  const propertyAssignments = sourceFile.getDescendantsOfKind(SyntaxKind.PropertyAssignment);
  propertyAssignments.forEach(prop => {
    if (prop.getName() === 'animation') {
      const init = prop.getInitializer();
      if (init && init.getKind() === SyntaxKind.ConditionalExpression) {
        const text = init.getText();
        if (text.includes("'none'") || text.includes('"none"')) {
          console.log(`⚡ [CLASS 3: Animation Snap] in ${fileName}`);
          console.log(`   Line ${prop.getStartLineNumber()}: Conditional animation dropping to 'none'.`);
          console.log(`   This causes a 1-frame visual snap. Use transition interpolation instead.\n`);
        }
      }
    }
  });
});
