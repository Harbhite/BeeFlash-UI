
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

//Vibe coded by ammaar@google.com

import { GoogleGenAI } from '@google/genai';
import React, { useState, useCallback, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom/client';
import JSZip from 'jszip';

import { Artifact, Session, ComponentVariation, LayoutType } from './types';
import { INITIAL_PLACEHOLDERS } from './constants';
import { generateId } from './utils';

import DottedGlowBackground from './components/DottedGlowBackground';
import ArtifactCard from './components/ArtifactCard';
import SideDrawer from './components/SideDrawer';
import { 
    ThinkingIcon, 
    CodeIcon, 
    SparklesIcon, 
    ArrowLeftIcon, 
    ArrowRightIcon, 
    ArrowUpIcon, 
    GridIcon,
    CopyIcon,
    CheckIcon,
    EditIcon,
    DownloadIcon,
    SunIcon,
    MoonIcon,
    ShareIcon,
    LayoutSingleIcon,
    LayoutDoubleIcon,
    LayoutMasonryIcon,
    RefreshIcon
} from './components/Icons';

function App() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentSessionIndex, setCurrentSessionIndex] = useState<number>(-1);
  const [focusedArtifactIndex, setFocusedArtifactIndex] = useState<number | null>(null);
  
  const [inputValue, setInputValue] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  const [placeholders, setPlaceholders] = useState<string[]>(INITIAL_PLACEHOLDERS);
  const [copyFeedback, setCopyFeedback] = useState(false);
  const [exportFeedback, setExportFeedback] = useState(false);
  const [shareFeedback, setShareFeedback] = useState(false);
  
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = localStorage.getItem('app-theme');
    if (saved) return saved as 'light' | 'dark';
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  });

  const [layout, setLayout] = useState<LayoutType>(() => {
    const saved = localStorage.getItem('app-layout');
    return (saved as LayoutType) || 'grid';
  });
  
  const [drawerState, setDrawerState] = useState<{
      isOpen: boolean;
      mode: 'code' | 'variations' | null;
      title: string;
      data: any; 
  }>({ isOpen: false, mode: null, title: '', data: null });

  const [componentVariations, setComponentVariations] = useState<ComponentVariation[]>([]);
  const [activeVariationIndex, setActiveVariationIndex] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const gridScrollRef = useRef<HTMLDivElement>(null);

  // Sync theme with DOM and localStorage
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('app-theme', theme);
  }, [theme]);

  // Sync layout with localStorage
  useEffect(() => {
    localStorage.setItem('app-layout', layout);
  }, [layout]);

  useEffect(() => {
      inputRef.current?.focus();
  }, []);

  // Fix for mobile: reset scroll when focusing an item
  useEffect(() => {
    if (focusedArtifactIndex !== null && window.innerWidth <= 1024) {
        if (gridScrollRef.current) {
            gridScrollRef.current.scrollTop = 0;
        }
        window.scrollTo(0, 0);
    }
  }, [focusedArtifactIndex]);

  // Cycle placeholders
  useEffect(() => {
      const interval = setInterval(() => {
          setPlaceholderIndex(prev => (prev + 1) % placeholders.length);
      }, 3000);
      return () => clearInterval(interval);
  }, [placeholders.length]);

  // Dynamic placeholder generation on load
  useEffect(() => {
      const fetchDynamicPlaceholders = async () => {
          try {
              const apiKey = process.env.API_KEY;
              if (!apiKey) return;
              const ai = new GoogleGenAI({ apiKey });
              const response = await ai.models.generateContent({
                  model: 'gemini-3-flash-preview',
                  contents: { 
                      role: 'user', 
                      parts: [{ 
                          text: 'Generate 20 creative, short, diverse UI component prompts (e.g. "bioluminescent task list"). Return ONLY a raw JSON array of strings. IP SAFEGUARD: Avoid referencing specific famous artists, movies, or brands.' 
                      }] 
                  }
              });
              const text = response.text || '[]';
              const jsonMatch = text.match(/\[[\s\S]*\]/);
              if (jsonMatch) {
                  const newPlaceholders = JSON.parse(jsonMatch[0]);
                  if (Array.isArray(newPlaceholders) && newPlaceholders.length > 0) {
                      const shuffled = newPlaceholders.sort(() => 0.5 - Math.random()).slice(0, 10);
                      setPlaceholders(prev => [...prev, ...shuffled]);
                  }
              }
          } catch (e) {
              console.warn("Silently failed to fetch dynamic placeholders", e);
          }
      };
      setTimeout(fetchDynamicPlaceholders, 1000);
  }, []);

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(event.target.value);
  };

  const parseJsonStream = async function* (responseStream: AsyncGenerator<{ text: string }>) {
      let buffer = '';
      for await (const chunk of responseStream) {
          const text = chunk.text;
          if (typeof text !== 'string') continue;
          buffer += text;
          let braceCount = 0;
          let start = buffer.indexOf('{');
          while (start !== -1) {
              braceCount = 0;
              let end = -1;
              for (let i = start; i < buffer.length; i++) {
                  if (buffer[i] === '{') braceCount++;
                  else if (buffer[i] === '}') braceCount--;
                  if (braceCount === 0 && i > start) {
                      end = i;
                      break;
                  }
              }
              if (end !== -1) {
                  const jsonString = buffer.substring(start, end + 1);
                  try {
                      yield JSON.parse(jsonString);
                      buffer = buffer.substring(end + 1);
                      start = buffer.indexOf('{');
                  } catch (e) {
                      start = buffer.indexOf('{', start + 1);
                  }
              } else {
                  break; 
              }
          }
      }
  };

  const handleGenerateVariations = useCallback(async () => {
    const currentSession = sessions[currentSessionIndex];
    if (!currentSession || focusedArtifactIndex === null) return;
    const currentArtifact = currentSession.artifacts[focusedArtifactIndex];

    setIsLoading(true);
    setComponentVariations([]);
    setActiveVariationIndex(0);
    setDrawerState({ isOpen: true, mode: 'variations', title: 'Component Variations', data: currentArtifact.id });

    try {
        const apiKey = process.env.API_KEY;
        if (!apiKey) throw new Error("API_KEY is not configured.");
        const ai = new GoogleGenAI({ apiKey });

        const prompt = `
You are a master UI/UX designer. Generate 3 RADICAL CONCEPTUAL VARIATIONS of: "${currentSession.prompt}".

**STRICT IP SAFEGUARD:**
No names of artists. Instead, describe the *Physicality* and *Material Logic* of the UI.

**CREATIVE GUIDANCE:**
1. "Asymmetrical Primary Grid" (Heavy black strokes, rectilinear structure).
2. "Suspended Kinetic Mobile" (Floating organic shapes, delicate connections).
3. "Grainy Risograph Press" (Tactile grain, monochromatic ink depth).

Required JSON Output Format (stream ONE object per line):
\`{ "name": "Persona Name", "html": "..." }\`
        `.trim();

        const responseStream = await ai.models.generateContentStream({
            model: 'gemini-3-flash-preview',
             contents: [{ parts: [{ text: prompt }], role: 'user' }],
             config: { temperature: 1.2 }
        });

        for await (const variation of parseJsonStream(responseStream)) {
            if (variation.name && variation.html) {
                setComponentVariations(prev => [...prev, variation]);
            }
        }
    } catch (e: any) {
        console.error("Error generating variations:", e);
    } finally {
        setIsLoading(false);
    }
  }, [sessions, currentSessionIndex, focusedArtifactIndex]);

  const applyVariation = (html: string) => {
      if (focusedArtifactIndex === null) return;
      setSessions(prev => prev.map((sess, i) => 
          i === currentSessionIndex ? {
              ...sess,
              artifacts: sess.artifacts.map((art, j) => 
                j === focusedArtifactIndex ? { ...art, html, status: 'complete' } : art
              )
          } : sess
      ));
      setDrawerState(s => ({ ...s, isOpen: false }));
  };

  const handleShowCode = () => {
      const currentSession = sessions[currentSessionIndex];
      if (currentSession && focusedArtifactIndex !== null) {
          const artifact = currentSession.artifacts[focusedArtifactIndex];
          setDrawerState({ isOpen: true, mode: 'code', title: 'Source Code', data: artifact.html });
      }
  };

  const handleCopyCode = async () => {
    const currentSession = sessions[currentSessionIndex];
    if (currentSession && focusedArtifactIndex !== null) {
      const artifact = currentSession.artifacts[focusedArtifactIndex];
      try {
        await navigator.clipboard.writeText(artifact.html);
        setCopyFeedback(true);
        setTimeout(() => setCopyFeedback(false), 2000);
      } catch (err) {
        console.error('Failed to copy code:', err);
      }
    }
  };

  const handleShare = async () => {
      const currentSession = sessions[currentSessionIndex];
      if (currentSession && focusedArtifactIndex !== null) {
          const artifact = currentSession.artifacts[focusedArtifactIndex];
          try {
              await navigator.clipboard.writeText(artifact.html);
              setShareFeedback(true);
              setTimeout(() => setShareFeedback(false), 2000);
          } catch (err) {
              console.error('Failed to share:', err);
          }
      }
  };

  const handleRegenerateArtifact = useCallback(async () => {
      const currentSession = sessions[currentSessionIndex];
      if (!currentSession || focusedArtifactIndex === null || isLoading) return;
      
      const artifact = currentSession.artifacts[focusedArtifactIndex];
      const promptToUse = currentSession.prompt;
      const styleInstruction = artifact.styleName;

      setIsLoading(true);
      
      // Update status to streaming locally
      setSessions(prev => prev.map(sess => 
          sess.id === currentSession.id ? {
              ...sess,
              artifacts: sess.artifacts.map((art, idx) => 
                  idx === focusedArtifactIndex ? { ...art, status: 'streaming', html: '' } : art
              )
          } : sess
      ));

      try {
          const apiKey = process.env.API_KEY;
          if (!apiKey) throw new Error("API_KEY missing.");
          const ai = new GoogleGenAI({ apiKey });

          const prompt = `
Regenerate a high-fidelity UI component for: "${promptToUse}" with the direction: "${styleInstruction}". 
Avoid repeating the previous design. Surprise me with quality.
Return ONLY RAW HTML. No markdown.
          `.trim();
          
          const responseStream = await ai.models.generateContentStream({
              model: 'gemini-3-flash-preview',
              contents: [{ parts: [{ text: prompt }], role: "user" }],
          });

          let accumulatedHtml = '';
          for await (const chunk of responseStream) {
              const text = chunk.text;
              if (typeof text === 'string') {
                  accumulatedHtml += text;
                  setSessions(prev => prev.map(sess => 
                      sess.id === currentSession.id ? {
                          ...sess,
                          artifacts: sess.artifacts.map((art, idx) => 
                              idx === focusedArtifactIndex ? { ...art, html: accumulatedHtml } : art
                          )
                      } : sess
                  ));
              }
          }
          
          let finalHtml = accumulatedHtml.trim();
          if (finalHtml.startsWith('```html')) finalHtml = finalHtml.substring(7).trimStart();
          if (finalHtml.startsWith('```')) finalHtml = finalHtml.substring(3).trimStart();
          if (finalHtml.endsWith('```')) finalHtml = finalHtml.substring(0, finalHtml.length - 3).trimEnd();

          setSessions(prev => prev.map(sess => 
              sess.id === currentSession.id ? {
                  ...sess,
                  artifacts: sess.artifacts.map((art, idx) => 
                      idx === focusedArtifactIndex ? { ...art, html: finalHtml, status: 'complete' } : art
                  )
              } : sess
          ));
      } catch (e) {
          console.error('Regeneration error:', e);
      } finally {
          setIsLoading(false);
      }
  }, [sessions, currentSessionIndex, focusedArtifactIndex, isLoading]);

  const handleExportSession = async () => {
    const currentSession = sessions[currentSessionIndex];
    if (!currentSession) return;
    
    try {
        const zip = new JSZip();
        currentSession.artifacts.forEach((art, i) => {
            const sanitizedName = art.styleName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
            const filename = `${i + 1}_${sanitizedName}.html`;
            zip.file(filename, art.html);
        });

        const content = await zip.generateAsync({ type: 'blob' });
        const url = URL.createObjectURL(content);
        const link = document.createElement('a');
        link.href = url;
        link.download = `flash_ui_${currentSession.id}.zip`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        setExportFeedback(true);
        setTimeout(() => setExportFeedback(false), 2000);
    } catch (err) {
        console.error('Failed to generate ZIP:', err);
    }
  };

  const handleEditPrompt = () => {
    const currentSession = sessions[currentSessionIndex];
    if (currentSession) {
      setInputValue(currentSession.prompt);
      setFocusedArtifactIndex(null);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  };

  const toggleTheme = () => {
    setTheme(prev => (prev === 'light' ? 'dark' : 'light'));
  };

  const handleSendMessage = useCallback(async (manualPrompt?: string) => {
    const promptToUse = manualPrompt || inputValue;
    const trimmedInput = promptToUse.trim();
    
    if (!trimmedInput || isLoading) return;
    if (!manualPrompt) setInputValue('');

    setIsLoading(true);
    const baseTime = Date.now();
    const sessionId = generateId();

    const placeholderArtifacts: Artifact[] = Array(4).fill(null).map((_, i) => ({
        id: `${sessionId}_${i}`,
        styleName: 'Designing...',
        html: '',
        status: 'streaming',
    }));

    const newSession: Session = {
        id: sessionId,
        prompt: trimmedInput,
        timestamp: baseTime,
        artifacts: placeholderArtifacts
    };

    setSessions(prev => [...prev, newSession]);
    setCurrentSessionIndex(sessions.length); 
    setFocusedArtifactIndex(null); 

    try {
        const apiKey = process.env.API_KEY;
        if (!apiKey) throw new Error("API_KEY is not configured.");
        const ai = new GoogleGenAI({ apiKey });

        const stylePrompt = `
Generate 4 distinct design directions for: "${trimmedInput}". 
Return ONLY a raw JSON array of 4 short names. No trademarks.
        `.trim();

        const styleResponse = await ai.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: { role: 'user', parts: [{ text: stylePrompt }] }
        });

        let generatedStyles: string[] = [];
        const styleText = styleResponse.text || '[]';
        const jsonMatch = styleText.match(/\[[\s\S]*\]/);
        
        if (jsonMatch) {
            try {
                generatedStyles = JSON.parse(jsonMatch[0]);
            } catch (e) {
                console.warn("Fallback to defaults");
            }
        }

        if (!generatedStyles || generatedStyles.length < 4) {
            generatedStyles = ["Direction 1", "Direction 2", "Direction 3", "Direction 4"];
        }
        
        generatedStyles = generatedStyles.slice(0, 4);

        setSessions(prev => prev.map(s => {
            if (s.id !== sessionId) return s;
            return {
                ...s,
                artifacts: s.artifacts.map((art, i) => ({
                    ...art,
                    styleName: generatedStyles[i]
                }))
            };
        }));

        const generateArtifact = async (artifact: Artifact, styleInstruction: string) => {
            try {
                const prompt = `
Create a high-fidelity UI component for: "${trimmedInput}" using the direction: "${styleInstruction}". 
Return ONLY RAW HTML. No markdown.
          `.trim();
          
                const responseStream = await ai.models.generateContentStream({
                    model: 'gemini-3-flash-preview',
                    contents: [{ parts: [{ text: prompt }], role: "user" }],
                });

                let accumulatedHtml = '';
                for await (const chunk of responseStream) {
                    const text = chunk.text;
                    if (typeof text === 'string') {
                        accumulatedHtml += text;
                        setSessions(prev => prev.map(sess => 
                            sess.id === sessionId ? {
                                ...sess,
                                artifacts: sess.artifacts.map(art => 
                                    art.id === artifact.id ? { ...art, html: accumulatedHtml } : art
                                )
                            } : sess
                        ));
                    }
                }
                
                let finalHtml = accumulatedHtml.trim();
                if (finalHtml.startsWith('```html')) finalHtml = finalHtml.substring(7).trimStart();
                if (finalHtml.startsWith('```')) finalHtml = finalHtml.substring(3).trimStart();
                if (finalHtml.endsWith('```')) finalHtml = finalHtml.substring(0, finalHtml.length - 3).trimEnd();

                setSessions(prev => prev.map(sess => 
                    sess.id === sessionId ? {
                        ...sess,
                        artifacts: sess.artifacts.map(art => 
                            art.id === artifact.id ? { ...art, html: finalHtml, status: finalHtml ? 'complete' : 'error' } : art
                        )
                    } : sess
                ));

            } catch (e: any) {
                console.error('Error:', e);
            }
        };

        await Promise.all(placeholderArtifacts.map((art, i) => generateArtifact(art, generatedStyles[i])));

    } catch (e) {
        console.error("Fatal error", e);
    } finally {
        setIsLoading(false);
        setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [inputValue, isLoading, sessions.length]);

  const handleSurpriseMe = () => {
      const currentPrompt = placeholders[placeholderIndex];
      setInputValue(currentPrompt);
      handleSendMessage(currentPrompt);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && !isLoading) {
      event.preventDefault();
      handleSendMessage();
    } else if (event.key === 'Tab' && !inputValue && !isLoading) {
        event.preventDefault();
        setInputValue(placeholders[placeholderIndex]);
    }
  };

  const nextItem = useCallback(() => {
      if (focusedArtifactIndex !== null) {
          if (focusedArtifactIndex < 3) setFocusedArtifactIndex(focusedArtifactIndex + 1);
      } else {
          if (currentSessionIndex < sessions.length - 1) setCurrentSessionIndex(currentSessionIndex + 1);
      }
  }, [currentSessionIndex, sessions.length, focusedArtifactIndex]);

  const prevItem = useCallback(() => {
      if (focusedArtifactIndex !== null) {
          if (focusedArtifactIndex > 0) setFocusedArtifactIndex(focusedArtifactIndex - 1);
      } else {
           if (currentSessionIndex > 0) setCurrentSessionIndex(currentSessionIndex - 1);
      }
  }, [currentSessionIndex, focusedArtifactIndex]);

  const isLoadingDrawer = isLoading && drawerState.mode === 'variations' && componentVariations.length === 0;

  const hasStarted = sessions.length > 0 || isLoading;
  const currentSession = sessions[currentSessionIndex];

  let canGoBack = false;
  let canGoForward = false;

  if (hasStarted) {
      if (focusedArtifactIndex !== null) {
          canGoBack = focusedArtifactIndex > 0;
          canGoForward = focusedArtifactIndex < (currentSession?.artifacts.length || 0) - 1;
      } else {
          canGoBack = currentSessionIndex > 0;
          canGoForward = currentSessionIndex < sessions.length - 1;
      }
  }

  const cycleVariation = (dir: number) => {
      setActiveVariationIndex(prev => (prev + dir + componentVariations.length) % componentVariations.length);
  };

  return (
    <>
        <div className="top-nav">
          <div className="layout-picker">
              <button 
                className={`layout-btn tooltip-trigger ${layout === 'single' ? 'active' : ''}`} 
                onClick={() => setLayout('single')} 
                data-tooltip="Single Column"
              >
                  <LayoutSingleIcon />
              </button>
              <button 
                className={`layout-btn tooltip-trigger ${layout === 'double' ? 'active' : ''}`} 
                onClick={() => setLayout('double')} 
                data-tooltip="Two Columns"
              >
                  <LayoutDoubleIcon />
              </button>
              <button 
                className={`layout-btn tooltip-trigger ${layout === 'grid' ? 'active' : ''}`} 
                onClick={() => setLayout('grid')} 
                data-tooltip="Grid View"
              >
                  <GridIcon />
              </button>
              <button 
                className={`layout-btn tooltip-trigger ${layout === 'masonry' ? 'active' : ''}`} 
                onClick={() => setLayout('masonry')} 
                data-tooltip="Masonry View"
              >
                  <LayoutMasonryIcon />
              </button>
          </div>
          <div className="nav-controls">
            <button className="theme-toggle tooltip-trigger" onClick={toggleTheme} data-tooltip="Toggle Theme">
              {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
            </button>
            <a href="https://x.com/ammaar" target="_blank" rel="noreferrer" className={`creator-credit ${hasStarted ? 'hide-on-mobile' : ''}`}>
                created by @ammaar
            </a>
          </div>
        </div>

        <SideDrawer 
            isOpen={drawerState.isOpen} 
            onClose={() => setDrawerState(s => ({...s, isOpen: false}))} 
            title={drawerState.title}
        >
            {isLoadingDrawer && (
                 <div className="loading-state">
                     <ThinkingIcon /> 
                     Thinking...
                 </div>
            )}

            {drawerState.mode === 'code' && (
                <div className="code-container">
                    <pre className="code-block"><code>{drawerState.data}</code></pre>
                </div>
            )}
            
            {drawerState.mode === 'variations' && componentVariations.length > 0 && (
                <div className="variation-carousel">
                    <div className="variation-display">
                        <div className="variation-preview-large">
                            <iframe 
                                srcDoc={componentVariations[activeVariationIndex].html} 
                                title={componentVariations[activeVariationIndex].name} 
                                sandbox="allow-scripts allow-same-origin" 
                            />
                        </div>
                        <div className="variation-controls">
                            <button className="carousel-nav" onClick={() => cycleVariation(-1)}><ArrowLeftIcon /></button>
                            <div className="variation-info">
                                <h3>{componentVariations[activeVariationIndex].name}</h3>
                                <p>Variation {activeVariationIndex + 1} of {componentVariations.length}</p>
                            </div>
                            <button className="carousel-nav" onClick={() => cycleVariation(1)}><ArrowRightIcon /></button>
                        </div>
                        <button 
                            className="apply-variation-btn" 
                            onClick={() => applyVariation(componentVariations[activeVariationIndex].html)}
                        >
                            <CheckIcon /> Use This Variation
                        </button>
                    </div>
                    <div className="variation-thumbnails">
                        {componentVariations.map((v, i) => (
                            <div 
                                key={i} 
                                className={`variation-thumb ${activeVariationIndex === i ? 'active' : ''}`}
                                onClick={() => setActiveVariationIndex(i)}
                            >
                                <div className="thumb-preview">
                                     <iframe srcDoc={v.html} sandbox="allow-scripts allow-same-origin" />
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </SideDrawer>

        <div className="immersive-app">
            <DottedGlowBackground 
                gap={24} 
                radius={1.5} 
                color={theme === 'dark' ? "rgba(255, 255, 255, 0.02)" : "rgba(0, 0, 0, 0.05)"} 
                glowColor={theme === 'dark' ? "rgba(255, 255, 255, 0.15)" : "rgba(0, 0, 0, 0.1)"} 
                speedScale={0.5} 
            />

            <div className={`stage-container ${focusedArtifactIndex !== null ? 'mode-focus' : 'mode-split'}`}>
                 <div className={`empty-state ${hasStarted ? 'fade-out' : ''}`}>
                     <div className="empty-content">
                         <h1>Flash UI</h1>
                         <p>Creative UI generation in a flash</p>
                         <button className="surprise-button" onClick={handleSurpriseMe} disabled={isLoading}>
                             <SparklesIcon /> Surprise Me
                         </button>
                     </div>
                 </div>

                {sessions.map((session, sIndex) => {
                    let positionClass = 'hidden';
                    if (sIndex === currentSessionIndex) positionClass = 'active-session';
                    else if (sIndex < currentSessionIndex) positionClass = 'past-session';
                    else if (sIndex > currentSessionIndex) positionClass = 'future-session';
                    
                    return (
                        <div key={session.id} className={`session-group ${positionClass}`}>
                            <div 
                                className={`artifact-grid layout-${layout}`} 
                                ref={sIndex === currentSessionIndex ? gridScrollRef : null}
                            >
                                {session.artifacts.map((artifact, aIndex) => {
                                    const isFocused = focusedArtifactIndex === aIndex;
                                    
                                    return (
                                        <ArtifactCard 
                                            key={artifact.id}
                                            artifact={artifact}
                                            isFocused={isFocused}
                                            onClick={() => setFocusedArtifactIndex(aIndex)}
                                        />
                                    );
                                })}
                            </div>
                        </div>
                    );
                })}
            </div>

             {canGoBack && (
                <button className="nav-handle left tooltip-trigger" onClick={prevItem} data-tooltip="Previous">
                    <ArrowLeftIcon />
                </button>
             )}
             {canGoForward && (
                <button className="nav-handle right tooltip-trigger" onClick={nextItem} data-tooltip="Next">
                    <ArrowRightIcon />
                </button>
             )}

            <div className={`action-bar ${focusedArtifactIndex !== null ? 'visible' : ''}`}>
                 <div className="active-prompt-label">
                    {currentSession?.prompt}
                 </div>
                 <div className="action-buttons">
                    <button onClick={() => setFocusedArtifactIndex(null)} className="action-btn tooltip-trigger" data-tooltip="Back to Grid">
                        <GridIcon /> <span className="btn-text">Grid View</span>
                    </button>
                    <button onClick={handleRegenerateArtifact} disabled={isLoading} className="action-btn tooltip-trigger" data-tooltip="Regenerate This Component">
                        <RefreshIcon /> <span className="btn-text">Generate More</span>
                    </button>
                    <button onClick={handleEditPrompt} className="action-btn tooltip-trigger" data-tooltip="Edit Your Prompt">
                        <EditIcon /> <span className="btn-text">Edit Prompt</span>
                    </button>
                    <button onClick={handleGenerateVariations} disabled={isLoading} className="action-btn tooltip-trigger" data-tooltip="Explore Visual Directions">
                        <SparklesIcon /> <span className="btn-text">Variations</span>
                    </button>
                    <button onClick={handleCopyCode} className="action-btn tooltip-trigger" data-tooltip="Copy to Clipboard">
                        {copyFeedback ? <CheckIcon /> : <CopyIcon />} <span className="btn-text">{copyFeedback ? 'Copied' : 'Copy HTML'}</span>
                    </button>
                    <button onClick={handleShare} className="action-btn tooltip-trigger" data-tooltip="Share Component Link">
                        {shareFeedback ? <CheckIcon /> : <ShareIcon />} <span className="btn-text">{shareFeedback ? 'Shared' : 'Share'}</span>
                    </button>
                    <button onClick={handleShowCode} className="action-btn tooltip-trigger" data-tooltip="View Source Code">
                        <CodeIcon /> <span className="btn-text">Source</span>
                    </button>
                    <button onClick={handleExportSession} className="action-btn tooltip-trigger" data-tooltip="Download All as ZIP">
                        {exportFeedback ? <CheckIcon /> : <DownloadIcon />} <span className="btn-text">{exportFeedback ? 'Exported' : 'Export Bundle'}</span>
                    </button>
                 </div>
            </div>

            <div className="floating-input-container">
                <div className={`input-wrapper ${isLoading ? 'loading' : ''}`}>
                    {(!inputValue && !isLoading) && (
                        <div className="animated-placeholder" key={placeholderIndex}>
                            <span className="placeholder-text">{placeholders[placeholderIndex]}</span>
                            <span className="tab-hint">Tab</span>
                        </div>
                    )}
                    {!isLoading ? (
                        <input 
                            ref={inputRef}
                            type="text" 
                            value={inputValue} 
                            onChange={handleInputChange} 
                            onKeyDown={handleKeyDown} 
                            disabled={isLoading} 
                            placeholder="Describe your UI..."
                        />
                    ) : (
                        <div className="input-generating-label">
                            <span className="generating-prompt-text">{currentSession?.prompt}</span>
                            <ThinkingIcon />
                        </div>
                    )}
                    <button className="send-button tooltip-trigger" onClick={() => handleSendMessage()} disabled={isLoading || !inputValue.trim()} data-tooltip="Generate UI">
                        <ArrowUpIcon />
                    </button>
                </div>
            </div>
        </div>
    </>
  );
}

const rootElement = document.getElementById('root');
if (rootElement) {
  const root = ReactDOM.createRoot(rootElement);
  root.render(<React.StrictMode><App /></React.StrictMode>);
}
