import './App.css';
import Graph from "react-graph-vis";
import React, { useState, useCallback } from "react";
import OpenAI from 'openai'

const DEFAULT_PARAMS = {
  "model": "gpt-4o",
  "temperature": 0.1,
  "max_tokens": 4000,
  "top_p": 1,
  "frequency_penalty": 0,
  "presence_penalty": 0
}

const SELECTED_PROMPT = "STATELESS"

const options = {
  layout: {
    hierarchical: {
      enabled: true,
      direction: "UD",      // Up to Down is typically best for call graphs
      sortMethod: "directed", // Better than "hubsize" for call graphs
      levelSeparation: 150, // Vertical space between levels
      nodeSpacing: 200,     // Horizontal space between nodes
      treeSpacing: 200,     // Distance between different trees
      blockShifting: true,  // Reduces number of edge crossings
      edgeMinimization: true, // Reduces edge length and crossings
      parentCentralization: false, // Less strict about parent positioning
      shakeTowards: "roots"  // Helps with cycle visualization
    }
  },
  edges: {
    color: "#34495e",
    arrows: {
      to: { enabled: true, scaleFactor: 1 } // Clear direction of calls
    },
    smooth: {
      type: "cubicBezier", // Helps with edge visibility in complex graphs
      roundness: 0.5
    }
  },
  physics: {
    enabled: false // Prevents constant movement, better for static analysis
  }
};

function App() {
  const [graphState, setGraphState] = useState({
    nodes: [],
    edges: []
  });
  const [isDragging, setIsDragging] = useState(false);

  const clearState = () => {
    setGraphState({
      nodes: [],
      edges: []
    });
  };

  const updateGraph = (updates) => {
    if (!updates || !Array.isArray(updates)) {
      console.error("Invalid updates format received");
      return;
    }

    var current_graph = JSON.parse(JSON.stringify(graphState));

    if (updates.length === 0) {
      return;
    }

    if (typeof updates[0] === "string") {
      updates = [updates]
    }

    updates.forEach(update => {
      if (update.length === 3) {
        const [entity1, relation, entity2] = update;

        var node1 = current_graph.nodes.find(node => node.id === entity1);
        var node2 = current_graph.nodes.find(node => node.id === entity2);

        if (node1 === undefined) {
          current_graph.nodes.push({ id: entity1, label: entity1, color: "#ffffff" });
        }

        if (node2 === undefined) {
          current_graph.nodes.push({ id: entity2, label: entity2, color: "#ffffff" });
        }

        var edge = current_graph.edges.find(edge => edge.from === entity1 && edge.to === entity2);
        if (edge !== undefined) {
          edge.label = relation;
          return;
        }

        current_graph.edges.push({ from: entity1, to: entity2, label: relation });

      } else if (update.length === 2 && update[1].startsWith("#")) {
        const [entity, color] = update;

        var node = current_graph.nodes.find(node => node.id === entity);

        if (node === undefined) {
          current_graph.nodes.push({ id: entity, label: entity, color: color });
          return;
        }

        node.color = color;

      } else if (update.length === 2 && update[0] == "DELETE") {
        const [_, index] = update;

        var node = current_graph.nodes.find(node => node.id === index);

        if (node === undefined) {
          return;
        }

        current_graph.nodes = current_graph.nodes.filter(node => node.id !== index);

        current_graph.edges = current_graph.edges.filter(edge => edge.from !== index && edge.to !== index);
      }
    });
    setGraphState(current_graph);
  };

  const queryStatelessPrompt = (prompt) => {
    if (!process.env.REACT_APP_OPENAI_API_KEY) {
      console.error("OpenAI API key is not set in environment variables");
      alert("OpenAI API key is not configured");
      return;
    }

    fetch('prompts/stateless.prompt')
      .then(response => response.text())
      .then(text => text.replace("$prompt", prompt))
      .then(prompt => {
        const openai = new OpenAI({ 
          apiKey: process.env.REACT_APP_OPENAI_API_KEY, 
          dangerouslyAllowBrowser: true
        })

        openai.chat.completions.create({
          ...DEFAULT_PARAMS,
          messages: [
            { 
              role: 'system', 
              content: 'You must respond with a valid JSON object only. No markdown, no backticks, no explanation.' 
            },
            { role: 'user', content: prompt }
          ],
          response_format: { type: 'json_object' }
        })
          .then((response) => {
            const text = response.choices[0].message.content;
            const parsedText = JSON.parse(text);
            
            if (!parsedText || !parsedText.updates) {
              throw new Error("Invalid response format: missing updates array");
            }
            
            const updates = parsedText.updates;
            updateGraph(updates);

            document.body.style.cursor = 'default';
          }).catch((error) => {
            console.log(error);
            alert(error);
          });
      })
  };

  const queryStatefulPrompt = (prompt) => {
    fetch('prompts/stateful.prompt')
      .then(response => response.text())
      .then(text => text.replace("$prompt", prompt))
      .then(text => text.replace("$state", JSON.stringify(graphState)))
      .then(prompt => {

        const openai = new OpenAI({ 
          apiKey: process.env.REACT_APP_OPENAI_API_KEY, 
          dangerouslyAllowBrowser: true 
        })

        openai.chat.completions.create({
          ...DEFAULT_PARAMS,
          messages: [
            { 
              role: 'system', 
              content: 'You must respond with a valid JSON object only. No markdown, no backticks, no explanation.' 
            },
            { role: 'user', content: prompt }
          ],
          response_format: { type: 'json_object' }
        })
          .then((response) => {
            const text = response.choices[0].message.content

            const new_graph = JSON.parse(text);

            setGraphState(new_graph);

            document.body.style.cursor = 'default';
          }).catch((error) => {
            console.log(error);
            alert(error);
          });
      })
  };

  const queryPrompt = (prompt) => {
    if (SELECTED_PROMPT === "STATELESS") {
      queryStatelessPrompt(prompt);
    } else if (SELECTED_PROMPT === "STATEFUL") {
      queryStatefulPrompt(prompt);
    } else {
      alert("Please select a prompt");
      document.body.style.cursor = 'default';
    }
  }

  const handleFile = (file) => {
    document.body.style.cursor = 'wait';
    
    const reader = new FileReader();
    reader.onload = (e) => {
      const fileContents = e.target.result;
      queryPrompt(fileContents);
    };
    
    reader.readAsText(file);
  };

  const onDragOver = useCallback((e) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const onDragLeave = useCallback((e) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const onDrop = useCallback((e) => {
    e.preventDefault();
    setIsDragging(false);
    
    const file = e.dataTransfer.files[0];
    if (file) {
      const fileExtension = file.name.split('.').pop().toLowerCase();
      const allowedExtensions = ['txt', 'js', 'py', 'java', 'cpp', 'c', 'h', 'cs', 'rb', 'php'];
      
      if (allowedExtensions.includes(fileExtension)) {
        handleFile(file);
      } else {
        alert('Please upload a valid code file');
      }
    }
  }, []);

  return (
    <div className='container'>
      <h1 className="headerText">codegraph</h1>
      <div 
        className={`graphContainer ${isDragging ? 'dragging' : ''} ${!graphState.nodes.length ? 'empty' : ''}`}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        {graphState.nodes.length > 0 ? (
          <>
            <button className="clearIcon" onClick={clearState}>×</button>
            <Graph 
              graph={graphState} 
              options={options} 
              style={{ width: '100%', height: '100%' }} 
            />
          </>
        ) : (
          <div className="dropzone">
            <div className="h-[calc(100vh-136px)] flex flex-col items-center justify-center">
              <p>Drop your code file here</p>
              <p className="supportedFormats">Supported formats: .txt, .js, .py, .java, .cpp, .c, .h, .cs, .rb, .php</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
