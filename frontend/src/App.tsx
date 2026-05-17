import { useState } from 'react';
import './App.css';
import Sidebar from './components/Sidebar';
import ChatArea from './components/ChatArea';
import RightSidebar from './components/RightSidebar';
import Login from './components/Login';

function App() {
  const [userId, setUserId] = useState<string | null>(null);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [activeCitation, setActiveCitation] = useState<string | null>(null);

  if (!userId) {
    return <Login onLogin={setUserId} />;
  }

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
        onShowCitation={setActiveCitation}
      />
      {activeCitation && (
        <RightSidebar 
          citationText={activeCitation} 
          onClose={() => setActiveCitation(null)} 
        />
      )}
    </div>
  );
}

export default App;
