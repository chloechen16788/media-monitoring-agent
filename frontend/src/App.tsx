import { useState } from 'react';
import './App.css';
import Sidebar from './components/Sidebar';
import ChatArea from './components/ChatArea';
import RightSidebar from './components/RightSidebar';
import Login from './components/Login';
interface RightPanelConfig {
  mode: 'citation' | 'workspace';
  data: string | any;
}

function App() {
  const [userId, setUserId] = useState<string | null>(null);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [rightPanel, setRightPanel] = useState<RightPanelConfig | null>(null);
  const [customInsights, setCustomInsights] = useState<Record<string, string>>({});

  if (!userId) {
    return <Login onLogin={setUserId} />;
  }

  const handleShowCitation = (text: string) => {
    setRightPanel({ mode: 'citation', data: text });
  };

  const handleOpenWorkspace = (config: any) => {
    setRightPanel({ mode: 'workspace', data: config });
  };

  const handleUpdateInsight = (target: string, text: string) => {
    setCustomInsights(prev => ({ ...prev, [target]: text }));
  };

  return (
    <div className="app-container">
      <Sidebar 
        userId={userId} 
        currentSessionId={currentSessionId} 
        onSelectSession={setCurrentSessionId} 
      />
      <ChatArea 
        userId={userId} 
        currentSessionId={currentSessionId} 
        onShowCitation={handleShowCitation}
        onOpenWorkspace={handleOpenWorkspace}
        onUpdateInsight={handleUpdateInsight}
      />
      {rightPanel && (
        <RightSidebar 
          config={rightPanel} 
          customInsights={customInsights}
          onClose={() => setRightPanel(null)} 
        />
      )}
    </div>
  );
}

export default App;
