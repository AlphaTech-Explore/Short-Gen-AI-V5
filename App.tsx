import React, { useState, useCallback, useEffect } from 'react';
import { generateScriptFromTopic, analyzeScriptForScenes, generateVoiceover, generateImageForScene, generateTitleAndHashtags } from './services/geminiService';
import { decode, decodeAudioData, audioBufferToWaveBlobUrl, blobUrlToBase64, base64ToBlobUrl } from './utils/audioUtils';
import { initDB, getProjectsFromDB, saveProjectToDB, deleteProjectFromDB } from './services/googleDriveService';
import type { Scene, SavedProject } from './types';
import ScriptInput from './components/ScriptInput';
import VideoPreview from './components/VideoPreview';
import Loader from './components/Loader';

type AppState = 'idle' | 'loading' | 'preview' | 'error';

const App: React.FC = () => {
  const [appState, setAppState] = useState<AppState>('idle');
  const [loadingMessage, setLoadingMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [audioUrl, setAudioUrl] = useState<string>('');
  const [currentTopic, setCurrentTopic] = useState('');
  const [title, setTitle] = useState('');
  const [hashtags, setHashtags] = useState('');
  const [projects, setProjects] = useState<SavedProject[]>([]);
  const [dbReady, setDbReady] = useState(false);

  useEffect(() => {
    const initialize = async () => {
      try {
        await initDB();
        setDbReady(true);
        const savedProjects = await getProjectsFromDB();
        if (savedProjects.length === 0) {
            console.log("No saved projects found in the database. This is normal if this is your first time using the app or if your browser data has been cleared.");
        }
        setProjects(savedProjects);
      } catch (e) {
        console.error("Failed to initialize DB and load projects", e);
        setErrorMessage("Could not load saved projects. Please refresh the page.");
        setAppState('error');
      }
    };
    initialize();
  }, []);

  const handleGenerateVideo = useCallback(async (topic: string) => {
    setAppState('loading');
    setCurrentTopic(topic);
    setTitle('');
    setHashtags('');
    try {
      setLoadingMessage('Generating script from your topic...');
      const script = await generateScriptFromTopic(topic);

      setLoadingMessage('Creating title & hashtags...');
      const { title: newTitle, hashtags: newHashtags } = await generateTitleAndHashtags(topic, script);
      setTitle(newTitle);
      setHashtags(newHashtags);

      setLoadingMessage('Analyzing your script...');
      const sceneData = await analyzeScriptForScenes(script);

      setLoadingMessage('Generating visuals for your scenes...');
      const imageGenerationPromises = sceneData.map(scene => 
          generateImageForScene(scene.sceneDescription)
      );
      const generatedImageUrls = await Promise.all(imageGenerationPromises);

      const finalScenes = sceneData.map((scene, index) => ({
          ...scene,
          imageUrl: generatedImageUrls[index],
      }));

      setScenes(finalScenes);

      setLoadingMessage('Generating Tamil voiceover...');
      const cleanedScriptForVoiceover = script
        .split('\n')
        .filter(line => !line.trim().startsWith('காட்சி:'))
        .join(' ');
      
      const audioData = await generateVoiceover(cleanedScriptForVoiceover);

      setLoadingMessage('Preparing your video...');
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      const decodedBytes = decode(audioData);
      const audioBuffer = await decodeAudioData(decodedBytes, audioContext, 24000, 1);
      const url = audioBufferToWaveBlobUrl(audioBuffer);
      setAudioUrl(url);

      setAppState('preview');
    } catch (err) {
      const error = err as Error;
      console.error(error);
      setErrorMessage(error.message || 'An unknown error occurred.');
      setAppState('error');
    }
  }, []);

  const handleRestart = () => {
    setAppState('idle');
    setScenes([]);
    setAudioUrl('');
    setErrorMessage('');
    setCurrentTopic('');
    setTitle('');
    setHashtags('');
  };

  const handleSaveProject = useCallback(async () => {
    if (!scenes.length || !audioUrl || !currentTopic || !dbReady) return;

    try {
      const audioData = await blobUrlToBase64(audioUrl);
      const newProject: SavedProject = {
        id: Date.now() + Math.floor(Math.random() * 1000),
        topic: currentTopic,
        scenes,
        audioData,
        title,
        hashtags,
      };
      await saveProjectToDB(newProject);
      const updatedProjects = [...projects, newProject];
      setProjects(updatedProjects);
    } catch (error) {
      console.error("Failed to save project:", error);
      setErrorMessage('Could not save the project. Please try again.');
      setAppState('error');
    }
  }, [scenes, audioUrl, currentTopic, projects, dbReady, title, hashtags]);

  const handleLoadProject = useCallback((project: SavedProject) => {
    try {
      const loadedAudioUrl = base64ToBlobUrl(project.audioData);
      setScenes(project.scenes);
      setAudioUrl(loadedAudioUrl);
      setCurrentTopic(project.topic);
      setTitle(project.title || '');
      setHashtags(project.hashtags || '');
      setAppState('preview');
    } catch (error) {
        console.error("Failed to load project:", error);
        setErrorMessage("Could not load project. The data might be corrupted.");
        setAppState('error');
    }
  }, []);

  const handleDeleteProject = useCallback(async (id: number) => {
    if (!dbReady) return;
    try {
      await deleteProjectFromDB(id);
      const updatedProjects = projects.filter(p => p.id !== id);
      setProjects(updatedProjects);
    } catch (error) {
        console.error("Failed to delete project:", error);
        setErrorMessage('Could not delete the project. Please try again.');
        setAppState('error');
    }
  }, [projects, dbReady]);

  const handleExportProject = useCallback((project: SavedProject) => {
    try {
      const projectJson = JSON.stringify(project, null, 2);
      const blob = new Blob([projectJson], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const safeTopic = project.topic.replace(/[^a-z0-9]/gi, '_').toLowerCase();
      link.download = `aishort-project-${safeTopic.slice(0, 20)}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Failed to export project:", error);
      setErrorMessage('Could not export the project. An unexpected error occurred.');
      setAppState('error');
    }
  }, []);

  const handleImportProject = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const text = e.target?.result;
        if (typeof text !== 'string') {
          throw new Error("File could not be read.");
        }
        const importedProject = JSON.parse(text) as Partial<SavedProject>;

        if (!importedProject.topic || !importedProject.scenes || !importedProject.audioData) {
          throw new Error("Invalid project file. It's missing topic, scenes, or audio data.");
        }

        const newProject: SavedProject = {
          id: Date.now() + Math.floor(Math.random() * 1000),
          topic: importedProject.topic,
          scenes: importedProject.scenes,
          audioData: importedProject.audioData,
          title: importedProject.title || '',
          hashtags: importedProject.hashtags || '',
        };

        await saveProjectToDB(newProject);
        setProjects(prev => [...prev, newProject]);
      } catch (err) {
        const error = err as Error;
        console.error("Failed to import project:", error);
        setErrorMessage(`Could not import project: ${error.message}`);
        setAppState('error');
      } finally {
        if (event.target) {
            event.target.value = '';
        }
      }
    };
    reader.onerror = () => {
        setErrorMessage("Failed to read the project file.");
        setAppState('error');
    };
    reader.readAsText(file);
  }, []);


  const renderContent = () => {
    switch (appState) {
      case 'loading':
        return <Loader message={loadingMessage} />;
      case 'preview':
        return <VideoPreview 
          scenes={scenes} 
          audioUrl={audioUrl} 
          onRestart={handleRestart} 
          onSaveProject={handleSaveProject} 
          dbReady={dbReady}
          title={title}
          hashtags={hashtags}
        />;
      case 'error':
        return (
          <div className="text-center p-8">
            <h2 className="text-2xl text-red-400 font-bold mb-4">Operation Failed</h2>
            <p className="text-gray-300 mb-6">{errorMessage}</p>
            <button onClick={handleRestart} className="bg-indigo-600 text-white font-semibold py-2 px-6 rounded-lg hover:bg-indigo-700">
              Try Again
            </button>
          </div>
        );
      case 'idle':
      default:
        return <ScriptInput 
          onGenerate={handleGenerateVideo} 
          disabled={!dbReady}
          projects={projects}
          onLoadProject={handleLoadProject}
          onDeleteProject={handleDeleteProject}
          onExportProject={handleExportProject}
          onImportProject={handleImportProject}
        />;
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-gray-900 text-white font-sans">
      <header className="text-center mb-8">
        <h1 className="text-4xl md:text-5xl font-bold">
          AI Shorts<span className="text-indigo-400"> Generator</span>
        </h1>
        <p className="text-gray-400 mt-2">Turn your Tamil scripts into 1-minute videos instantly.</p>
      </header>
      <main className="w-full">
        {renderContent()}
      </main>
    </div>
  );
};

export default App;