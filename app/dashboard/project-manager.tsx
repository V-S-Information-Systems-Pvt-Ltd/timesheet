// app/dashboard/project-manager.tsx
'use client'

import { useState } from 'react'
import { addProject, deleteProject, renameProject, setProjectSO } from '../actions'
import { Project } from '../types'

export default function ProjectManager({
  projects,
  onChanged,
}: {
  projects: Project[]
  onChanged: () => void
}) {
  const [newProjectName, setNewProjectName] = useState('')

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    const { error } = await addProject(newProjectName)
    if (error) alert('Error: ' + error)
    else {
      setNewProjectName('')
      onChanged()
    }
  }

  const handleRename = async (p: Project) => {
    const name = prompt('New name for project:', p.name)
    if (!name || name.trim() === p.name) return
    const { error } = await renameProject(p.id, name)
    if (error) alert('Error: ' + error)
    else onChanged()
  }

  const handleSetSO = async (p: Project) => {
    const so = prompt('S.O. Number:', p.so_number || '')
    if (so === null) return
    const { error } = await setProjectSO(p.id, so)
    if (error) alert('Error: ' + error)
    else onChanged()
  }

  const handleDelete = async (p: Project) => {
    if (!confirm(`Delete project "${p.name}"?\n\nProjects with entries cannot be deleted until those entries are removed.`)) return
    const { error } = await deleteProject(p.id)
    if (error) alert('Error: ' + error)
    else onChanged()
  }

  return (
    <div className="bg-white p-6 rounded-lg shadow-sm border">
      <h2 className="text-xl font-semibold mb-4 text-purple-700">Project Management</h2>
      <form onSubmit={handleAdd} className="flex gap-2 mb-4">
        <input
          type="text"
          placeholder="New Project Name"
          value={newProjectName}
          onChange={(e) => setNewProjectName(e.target.value)}
          required
          className="flex-1 border p-2 rounded"
        />
        <button type="submit" className="bg-purple-600 text-white px-4 py-2 rounded hover:bg-purple-700">
          Add Project
        </button>
      </form>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {projects.map(p => (
          <div key={p.id} className="bg-gray-50 p-3 rounded text-sm border">
            <div className="font-medium">{p.name}</div>
            <div className="text-xs text-gray-500 mb-2">
              {p.so_number ? `S.O. ${p.so_number}` : 'No S.O. number'}
            </div>
            <div className="flex gap-2 text-xs">
              <button onClick={() => handleRename(p)} className="text-blue-600 hover:underline">Rename</button>
              <button onClick={() => handleSetSO(p)} className="text-blue-600 hover:underline">
                {p.so_number ? 'Change S.O.' : 'Set S.O.'}
              </button>
              {p.so_number && (
                <button onClick={() => setProjectSO(p.id, '').then(r => { if (r.error) alert('Error: ' + r.error); else onChanged() })} className="text-gray-600 hover:underline">
                  Clear S.O.
                </button>
              )}
              <button onClick={() => handleDelete(p)} className="text-red-600 hover:underline">Delete</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
