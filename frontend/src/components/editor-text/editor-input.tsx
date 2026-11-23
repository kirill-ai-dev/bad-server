import {
    ContentEditableEvent,
    createButton,
    Editor,
    EditorProvider,
    Toolbar,
} from 'react-simple-wysiwyg'
import './editor-input.scss'
import { sanitizeComment } from '../../utils/sanitize'

type EditorInputProps = {
    value: string
    onChange: (value: string) => void
}

export default function EditorInput({ onChange, value }: EditorInputProps) {
    function handleChangeElement(e: ContentEditableEvent) {
        onChange(e.target.value)
    }

    const BtnLinkCustom = createButton(
        'Вставить ссылку',
        '🔗',
        ({ $selection }) => {
            if ($selection?.nodeName === 'A') {
                const url = prompt('URL', '') || ''
                if (!/^https?:\/\//i.test(url)) return
                document.execCommand('unlink')
            } else {
                const url = prompt('URL', '') || ''
                if (!/^https?:\/\//i.test(url)) return
                document.execCommand('createLink', false, url)
            }
        }
    )

    return (
        <div className='customEditor'>
            <EditorProvider>
                <Editor
                    value={sanitizeComment(value)}
                    onChange={handleChangeElement}
                >
                    <Toolbar>
                        <span className='rsw-link-title'>
                            Вставить ссылку <BtnLinkCustom />
                        </span>
                    </Toolbar>
                </Editor>
            </EditorProvider>
        </div>
    )
}
