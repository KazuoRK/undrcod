 NOT set cssInspectorPanelOpen to false - drag should still work
			// Do NOT clear selectedElement or detach drag handlers
		} else if (event.data.type === 'update-style-changelog') {
			// Update the style changes array
			styleChanges = event.data.changes || [];
		} else if (event.data.type === 'apply-style-change') {
			// Apply style changes to the target element
			// First try to find element by elementPath (for redo operations), fall back to selectedElement
			if (event.data.property && event.data.value !== undefined) {
				let targetElement = null;

				// Try to find element by elementPath (could be a unique ID or a path)
				if (event.data.elementPath) {
					// First try as unique ID (most reliable)
					targetElement = getElementByUniqueId(event.data.elementPath);
					// Fallback to path-based lookup
					if (!targetElement) {
						targetElement = getElementFromPath(event.data.elementPath);
					}
					// If elementPath was provided but element not found, don't fall back to selectedElement
					// This prevents applying changes to the wrong element during redo
					if (!targetElement) {
						console.warn('[CSS Inspector] Could not find element for redo:', event.data.elementPath);
						return;
					}
				} else {
					// Only use selectedElement when no elementPath was provided (live editing)
					targetElement = selectedElement;
				}

				if (targetElement) {
					const property = event.data.property;
					const value = event.data.value;

					if (value === '' || value === 'initial' || value === 'unset') {
						// Remove the property if empty value
						targetElement.style.removeProperty(property);
					} else {
						// Set the property
						targetElement.style.setProperty(property, value);
					}

					// Notify the overlay system to update its highlight
					window.postMessage({ type: 'update-css-inspector-highlight' }, '*');

					// Send back the updated element info with new styles
					// Skip CSS variables - they don't change during style updates and are cached
					setTimeout(() => {
						// Small delay to ensure styles are applied
						sendElementUpdate(false, { skipCssVariables: true });
					}, 50);
				}
			}
		} else if (event.data.type === 'reset-style-changes') {
			resetStyleChangesInDocument(event.data.changes || []);
		} else if (event.data.type === 'update-react-prop') {
			// Update React component prop
			// First try to find element by elementPath (for redo operations), fall back to selectedElement
			if (event.data.propPath !== undefined) {
				let targetElement = null;

				// Try to find element by elementPath (could be a unique ID or a path)
				if (event.data.elementPath) {
					// First try as unique ID (most reliable)
					targetElement = getElementByUniqueId(event.data.elementPath);
					// Fallback to path-based lookup
					if (!targetElement) {
						targetElement = getElementFromPath(event.data.elementPath);
					}
					// If elementPath was provided but element not found, don't fall back to selectedElement
					// This prevents applying changes to the wrong element during redo
					if (!targetElement) {
						console.warn('[CSS Inspector] Could not find element for prop redo:', event.data.elementPath);
						return;
					}
				} else {
					// Only use selectedElement when no elementPath was provided (live editing)
					targetElement = selectedElement;
					if (!targetElement) {
						return;
					}
				}

				const propPath = event.data.propPath;
				const newValue = event.data.value;

				const success = updateReactProp(targetElement, propPath, newValue);

				// Notify the overlay system to update its highlight
				window.postMessage({ type: 'update-css-inspector-highlight' }, '*');

				// Send back the updated element info after delays to let React re-render
				// Use multiple attempts with increasing delays to catch async updates
				// Skip CSS variables - they don't change during prop updates
				const sendUpdates = [50, 150, 300, 500];
				let sentUpdate = false;

				sendUpdates.forEach((delay, index) => {
					setTimeout(() => {
						if (!sentUpdate || index === sendUpdates.length - 1) {
							sendElementUpdate(false, { skipCssVariables: true });
							sentUpdate = true;
						}
					}, delay);
				});

				// Send success/failure notification back
