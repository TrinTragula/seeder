import React from 'react';
import './App.css';
import {
  BrowserRouter as Router,
  Switch,
  Route,
  Link
} from "react-router-dom";
import Seeder from './pages/Seeder';
import About from './pages/About';

function App() {
  return (
    <Router>
      <div className="flex-column height-total">
        <div className="header flex-row flex-align-center">
          <div className="flex-grow-1">
            <h3>
              <Link className="header-link" to="/">
                Seeder
              </Link>
            </h3>
          </div>
          <div className="flex-row">
            <a className="header-link" href="https://github.com/TrinTragula/seeder" target="_blank" rel="noreferrer">
              Github
            </a>
            <a className="margin-left-15 header-link" href="https://twitter.com/McSeeder" target="_blank" rel="noreferrer">
              Twitter
            </a>
            <Link className="margin-left-15 header-link" to="/about">
              About
            </Link>
          </div>
        </div>
        <div className="flex-row flex-grow-1 overflow-auto">
          <Switch>
            <Route path="/about">
              <About />
            </Route>
            <Route path="/">
              <Seeder />
            </Route>
          </Switch>
        </div>
      </div>
    </Router>
  );
}

export default App;
