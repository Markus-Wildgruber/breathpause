import { mount } from 'svelte'
import PatternEditor from './PatternEditor.svelte'

const app = mount(PatternEditor, {
  target: document.getElementById('app'),
})

export default app
